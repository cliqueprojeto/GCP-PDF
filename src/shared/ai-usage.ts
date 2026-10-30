export interface AiUsage { day:string; requests:number; responses:number; limited:number; failures:number }
export function usageToday(value:AiUsage|undefined,day=new Date().toLocaleDateString('sv-SE')):AiUsage {
 return value?.day===day?{...value}:{day,requests:0,responses:0,limited:0,failures:0};
}
export function recordUsage(value:AiUsage|undefined,status:number,day?:string):AiUsage {
 const next=usageToday(value,day);next.requests++;
 if(status>=200&&status<300)next.responses++;else if(status===429)next.limited++;else next.failures++;
 return next;
}
