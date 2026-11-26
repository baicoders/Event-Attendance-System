import { lessons, type HelpTopic } from './lessons';
export function GuideIllustration({kind}:{kind:'class'|'scan'|'ready'}){
 // Separate lightweight SVG assets are decorative; all instruction text is native.
 // eslint-disable-next-line @next/next/no-img-element
 return <img src={'/classroom/guide/'+kind+'.svg'} alt="" width={400} height={270} className="mx-auto h-auto max-h-52 w-full max-w-sm"/>;
}
export default function TeacherLesson({topic}:{topic:HelpTopic}){
 const lesson=lessons[topic];return <div className="space-y-5 text-sm leading-6"><GuideIllustration kind={lesson.art}/><p>{lesson.explanation}</p><ol className="list-decimal space-y-3 pl-5">{lesson.steps.map(step=><li key={step}>{step}</li>)}</ol><figure className="rounded-2xl bg-indigo-50 p-4"><figcaption className="mb-3 font-semibold text-indigo-950">Example · demonstration only</figcaption><ol className="space-y-3">{lesson.demo.map((line,index)=><li key={line} className="flex gap-3"><span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-indigo-700">{index+1}</span><span>{line}</span></li>)}</ol></figure></div>;
}
