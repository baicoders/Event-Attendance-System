"""Read the source attendance workbook using only the Python standard library.

Writes participant JSON to stdout for the seed CLI; treat that JSON as private.
Rejects a changed/malformed workbook rather than silently skipping numbered rows.
"""
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
EXPECTED = {"SSC Officers": 13, "SSLG Officers": 27, "CS Officers": 14,
            "BA Officers": 11, "YHS Officers": 13, "CCJ Officers": 12,
            "House Lords/Ladies": 5}


def parse_workbook(path):
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = next((s for s in workbook.findall("s:sheets/s:sheet", NS)
                      if s.get("name") == "ATTENDANCE"), None)
        if sheet is None:
            raise ValueError("Workbook must contain an ATTENDANCE sheet")
        relation_id = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relationship = next((r for r in relationships if r.get("Id") == relation_id), None)
        if relationship is None or relationship.get("TargetMode") == "External":
            raise ValueError("Attendance sheet must be stored inside the workbook")
        target = relationship.get("Target", "")
        sheet_path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
        if not sheet_path.startswith("xl/"):
            raise ValueError("Invalid sheet relationship")
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(t.text or "" for t in si.findall(".//s:t", NS))
                       for si in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        root = ET.fromstring(archive.read(sheet_path))
        participants, group = [], None
        counts = {name: 0 for name in EXPECTED}
        seen_headers = set()
        for row in root.findall("s:sheetData/s:row", NS):
            cells = {}
            formulas = set()
            for cell in row.findall("s:c", NS):
                column = re.sub(r"\d", "", cell.get("r", ""))
                if cell.find("s:f", NS) is not None:
                    formulas.add(column)
                value = cell.findtext("s:v", "", NS)
                if cell.get("t") == "s":
                    value = strings[int(value)]
                elif cell.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in cell.findall(".//s:t", NS))
                cells[column] = value.strip()
            label = cells.get("A", "")
            header_group = next((name for name in EXPECTED if "(" + name.upper() + ")" in label.upper()), None)
            if label.upper() == "COLLEGE DEPARTMENT HOUSE LORD/LADY":
                header_group = "House Lords/Ladies"
            if header_group:
                if header_group in seen_headers:
                    raise ValueError("Repeated group header: " + header_group)
                group = header_group
                seen_headers.add(group)
                continue
            if not re.fullmatch(r"\d+", label):
                continue
            if group is None or not cells.get("B"):
                raise ValueError("Numbered row has no group or participant name: " + row.get("r", "?"))
            if formulas.intersection({"A", "B", "C"}):
                raise ValueError("Participant rows cannot contain formulas")
            counts[group] += 1
            if int(label) != counts[group]:
                raise ValueError("Participant numbering is not consecutive in " + group)
            participants.append({"row": int(row.get("r")), "group": group,
                                 "name": cells["B"], "position": cells.get("C") or None})
        if counts != EXPECTED:
            raise ValueError("Participant counts do not match expected workbook: " + json.dumps(counts))
        return {"sheet": "ATTENDANCE", "expected": EXPECTED, "participants": participants}


if __name__ == "__main__":
    try:
        print(json.dumps(parse_workbook(sys.argv[1]), ensure_ascii=False))
    except (ValueError, KeyError, IndexError, ET.ParseError, zipfile.BadZipFile, OSError) as error:
        print("Workbook validation failed: " + str(error), file=sys.stderr)
        sys.exit(1)
