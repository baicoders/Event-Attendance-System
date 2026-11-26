import 'server-only';
import ExcelJS from 'exceljs';
import type { ClassroomReport } from '../types/report';
import {
 buildRegisterMarks, orderRegisterRows, registerHeader, registerIdentifier,
 registerMarkLabels, registerMeetingHeadings, registerStudentName, registerYearGroups,
} from '../utils/reportRegister';

const edge = {style:'thin',color:{argb:'FF333333'}} as const;
const border = {top:edge,right:edge,bottom:edge,left:edge};

export async function buildRegisterXlsx(report: ClassroomReport) {
 const workbook = new ExcelJS.Workbook();
 const rows = orderRegisterRows(report.rows);
 const meetings = registerMeetingHeadings(report.meetings);
 const header = registerHeader(report,rows.length);
 const firstMeetingColumn = 4;
 const totalColumn = firstMeetingColumn + meetings.length;
 const lastColumn = totalColumn + 1;
 const headingEndColumn=Math.min(lastColumn,17);
 const firstHeaderRow = lastColumn>=7?12:14;
 const hasTimes=meetings.some(meeting=>meeting.time);
 const lastHeaderRow=firstHeaderRow+(hasTimes?3:2);
 const firstStudentRow = lastHeaderRow+1;
 const sheet = workbook.addWorksheet('ATTENDANCES_REPORT', {
  views:[{state:'frozen',xSplit:3,ySplit:lastHeaderRow}],
  pageSetup:{paperSize:9,orientation:'portrait',horizontalCentered:true,
   printTitlesRow:`${firstHeaderRow}:${lastHeaderRow}`,printTitlesColumn:'A:C',
   ...(meetings.length<=12?{fitToPage:true,fitToWidth:1,fitToHeight:0}:{})},
 });

 [6,16,34].forEach((width,index)=>{sheet.getColumn(index+1).width=width;});
 for(let column=firstMeetingColumn;column<totalColumn;column++)sheet.getColumn(column).width=hasTimes?10:8;
 sheet.getColumn(totalColumn).width=8;
 sheet.getColumn(lastColumn).width=18;
 for(const [row,value] of [[2,header.school.toUpperCase()],[3,header.title],[4,header.term]] as const){
  sheet.mergeCells(row,1,row,headingEndColumn);
  const cell=sheet.getCell(row,1);
  cell.value=value;
  cell.font={bold:row===3};
  cell.alignment={horizontal:'center'};
 }
 header.fields.forEach(([label,value],index)=>{
  const right=index>=5&&lastColumn>=7;
  const row=index<5?6+index:right?9+index-5:6+index;
  const start=right?headingEndColumn-3:2;
  const labelEnd=right?start+1:start;
  if(labelEnd>start)sheet.mergeCells(row,start,row,labelEnd);
  const labelCell=sheet.getCell(row,start);
  labelCell.value=label;
  labelCell.font={bold:true};
  labelCell.alignment={horizontal:'right',vertical:'middle'};
  const valueColumn=labelEnd+1;
  const valueEnd=right||lastColumn<7||row<9?headingEndColumn:headingEndColumn-4;
  if(valueEnd>valueColumn)sheet.mergeCells(row,valueColumn,row,valueEnd);
  sheet.getCell(row,valueColumn).value=value;
  sheet.getCell(row,valueColumn).alignment={horizontal:'left',wrapText:true,vertical:'middle'};
  if(typeof value==='string'&&value.length>42)sheet.getRow(row).height=28;
 });

 for(const [column,label] of [[1,'NO.'],[2,'USN'],[3,'STUDENT NAME'],[totalColumn,'TOTAL'],[lastColumn,'REMARKS']] as const){
  sheet.mergeCells(firstHeaderRow,column,lastHeaderRow,column);
  sheet.getCell(firstHeaderRow,column).value=label;
 }
 if(meetings.length){
  if(meetings.length>1)sheet.mergeCells(firstHeaderRow,firstMeetingColumn,firstHeaderRow,totalColumn-1);
  sheet.getCell(firstHeaderRow,firstMeetingColumn).value='ATTENDANCE';
 }
 const yearRow=firstHeaderRow+1;
 for(const {year,start,count} of registerYearGroups(meetings)){
  const column=firstMeetingColumn+start;
  if(count>1)sheet.mergeCells(yearRow,column,yearRow,column+count-1);
  sheet.getCell(yearRow,column).value=year;
 }
 for(const [index,meeting] of meetings.entries()){
  const column=firstMeetingColumn+index;
  const date=new Date(meeting.date+'T00:00:00Z');
  const day=sheet.getCell(firstHeaderRow+2,column);
  day.value=date;
  day.numFmt='mm-dd';
  if(meeting.time)sheet.getCell(firstHeaderRow+3,column).value=meeting.time+(meeting.occurrence?' #'+meeting.occurrence:'');
 }

 const marks=buildRegisterMarks(report.entries,rows,meetings.map(meeting=>meeting.id));
 for(const [index,row] of rows.entries()){
  const sheetRow=sheet.getRow(firstStudentRow+index);
  sheetRow.values=[index+1,registerIdentifier(row.identity),registerStudentName(row.identity),
   ...marks[index].map(mark=>registerMarkLabels[mark][0]),row.counts.attended];
  sheetRow.getCell(2).numFmt='@';
 }
 for(let row=firstHeaderRow;row<firstStudentRow+rows.length;row++){
  for(let column=1;column<=lastColumn;column++){
   const cell=sheet.getCell(row,column);
   cell.border=border;
   cell.alignment={horizontal:row>=firstStudentRow&&column===3?'left':'center',vertical:'middle',wrapText:true};
   if(row<firstStudentRow)cell.font={bold:true};
  }
 }
 const footer=firstStudentRow+rows.length;
 sheet.mergeCells(footer,1,footer,headingEndColumn);
 sheet.getCell(footer,1).value='*** NOTHING FOLLOWS ***';
 sheet.getCell(footer,1).alignment={horizontal:'center'};
 sheet.getCell(footer+2,2).value='PREPARED BY';
 sheet.getCell(footer+3,2).value=header.instructor;
 sheet.getCell(footer+5,2).value='DATE SUBMITTED';
 sheet.getCell(footer+6,2).value=header.dateSubmitted;
 return workbook.xlsx.writeBuffer();
}
