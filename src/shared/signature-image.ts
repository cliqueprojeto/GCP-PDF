/** Local pixel processing for handwritten signature imports. The original is never mutated. */
export interface PixelImage {width:number;height:number;data:Uint8ClampedArray<ArrayBuffer>}
export type BackgroundColor=readonly [number,number,number];
export interface SignatureImageAnalysis {transparent:boolean;background:BackgroundColor|null}
export interface PixelCrop {x:number;y:number;width:number;height:number}
export function analyzeSignatureImage(image:PixelImage):SignatureImageAnalysis {
 const {width,height,data}=image;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16_000_000||data.length!==width*height*4)throw new Error('Use uma imagem de assinatura de até 16 megapixels.');
 for(let at=3;at<data.length;at+=4)if(data[at]!<255)return {transparent:true,background:null};
 // Most frequent colour along the whole border avoids treating an inked corner as paper.
 const buckets=new Map<number,{count:number;r:number;g:number;b:number}>();
 const sample=(x:number,y:number)=>{const at=(y*width+x)*4,r=data[at]!,g=data[at+1]!,b=data[at+2]!,key=((r>>4)<<8)|((g>>4)<<4)|(b>>4),entry=buckets.get(key)??{count:0,r:0,g:0,b:0};entry.count++;entry.r+=r;entry.g+=g;entry.b+=b;buckets.set(key,entry);};
 const step=Math.max(1,Math.ceil((width+height)*2/4096));
 for(let x=0;x<width;x+=step){sample(x,0);sample(x,height-1);}
 for(let y=0;y<height;y+=step){sample(0,y);sample(width-1,y);}
 const best=[...buckets.values()].reduce((a,b)=>a.count>=b.count?a:b);
 return {transparent:false,background:[Math.round(best.r/best.count),Math.round(best.g/best.count),Math.round(best.b/best.count)]};
}
export function cleanSignatureImage(image:PixelImage,analysis:SignatureImageAnalysis,strength:number,remove:boolean,background=analysis.background):PixelImage {
 const data=new Uint8ClampedArray(image.data);
 // Existing alpha always wins, including anti-aliased and partly transparent signatures.
 if(analysis.transparent||!remove||!background)return {...image,data};
 const threshold=2+Math.max(0,Math.min(100,strength))*.65,fade=Math.max(48,160-threshold);
 for(let at=0;at<data.length;at+=4){
  const distance=Math.max(Math.abs(image.data[at]!-background[0]),Math.abs(image.data[at+1]!-background[1]),Math.abs(image.data[at+2]!-background[2]));
  const alpha=Math.max(0,Math.min(1,(distance-threshold)/fade));
  data[at+3]=Math.round(alpha*255);
  if(alpha===0){data[at]=data[at+1]=data[at+2]=0;}
  else if(alpha<1)for(let c=0;c<3;c++)data[at+c]=Math.round((image.data[at+c]!-background[c]!*(1-alpha))/alpha);
 }
 return {...image,data};
}
export function signatureInkBounds(image:PixelImage):PixelCrop|null {
 let left=image.width,top=image.height,right=-1,bottom=-1;
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]!>12){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
 if(right<0)return null;
 const padding=Math.max(2,Math.round(Math.max(right-left,bottom-top)*.02));
 left=Math.max(0,left-padding);top=Math.max(0,top-padding);right=Math.min(image.width-1,right+padding);bottom=Math.min(image.height-1,bottom+padding);
 return {x:left,y:top,width:right-left+1,height:bottom-top+1};
}
