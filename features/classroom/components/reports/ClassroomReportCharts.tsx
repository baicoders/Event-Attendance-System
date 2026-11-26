'use client';
import { Bar,BarChart,CartesianGrid,Cell,LabelList,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts';
import { CHART_COLORS } from '@/globals/constants/attendance';
import ChartPanel from '@/features/reports/components/charts/ChartPanel';
import { axisProps,gridProps,TooltipCard } from '@/features/reports/components/charts/chartTheme';
import { formatReportDateTime } from '@/globals/utils/reportTime';
import type { ClassroomReport } from '../../types/report';

export default function ClassroomReportCharts({report}:{report:Pick<ClassroomReport,'meetings'|'totals'>}) {
 const meetings=report.meetings.map(meeting=>({...meeting,rate:meeting.counts.rate,label:new Intl.DateTimeFormat('en',{timeZone:'Asia/Manila',month:'short',day:'numeric'}).format(new Date(meeting.scheduledStartAt))}));
 const breakdown=[{label:'Present',count:report.totals.present,color:CHART_COLORS.present},{label:'Late',count:report.totals.late,color:CHART_COLORS.late},{label:'Absent',count:report.totals.absent,color:CHART_COLORS.absent},{label:'Excused',count:report.totals.excused,color:CHART_COLORS.primary}];
 return <div className="grid min-w-0 gap-4 lg:grid-cols-2">
  <ChartPanel className="min-w-0" title="Attendance over time" description="Rate for each eligible finalized meeting · Asia/Manila" isEmpty={!meetings.some(meeting=>meeting.rate!==null)} emptyMessage="No meetings with a counted attendance rate." height={220}>
   <ResponsiveContainer width="100%" height="100%"><LineChart data={meetings} title="Attendance rate by meeting" margin={{top:8,right:12,bottom:4,left:-8}}><CartesianGrid {...gridProps}/><XAxis dataKey="id" tickFormatter={id=>meetings.find(meeting=>meeting.id===id)?.label??''} {...axisProps}/><YAxis domain={[0,100]} tickFormatter={value=>`${value}%`} {...axisProps}/><Tooltip content={({active,payload})=>{if(!active||!payload?.length)return null;const point=payload[0].payload as typeof meetings[number];return <TooltipCard label={point.className} rows={[{key:'date',label:'Meeting',value:formatReportDateTime(point.scheduledStartAt)},{key:'rate',label:'Attendance rate',value:point.counts.rateText}]} />;}}/><Line dataKey="rate" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{r:3}} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer>
  </ChartPanel>
  <ChartPanel className="min-w-0" title="Attendance breakdown" description="Eligible student-meetings in this report" isEmpty={!report.totals.eligibleMeetings} emptyMessage="No eligible finalized attendance in this selection." height={220}>
   <ResponsiveContainer width="100%" height="100%"><BarChart data={breakdown} layout="vertical" title="Present, Late, Absent and Excused counts" margin={{top:4,right:40,bottom:4,left:0}}><CartesianGrid {...gridProps} vertical horizontal={false}/><XAxis type="number" allowDecimals={false} {...axisProps}/><YAxis type="category" dataKey="label" width={65} {...axisProps}/><Tooltip content={({active,payload})=>active&&payload?.length?<TooltipCard label={payload[0].payload.label} rows={[{key:'count',label:'Student-meetings',value:payload[0].payload.count}]}/>:null}/><Bar dataKey="count" barSize={20} radius={[0,4,4,0]} isAnimationActive={false}>{breakdown.map(item=><Cell key={item.label} fill={item.color}/>)}<LabelList dataKey="count" position="right" fill={CHART_COLORS.axis} fontSize={12}/></Bar></BarChart></ResponsiveContainer>
  </ChartPanel>
 </div>;
}
