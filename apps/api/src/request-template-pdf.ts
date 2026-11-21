import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {unzipSync,strFromU8} from 'fflate';

const font = (name:string) => fileURLToPath(new URL(`../assets/LiberationSerif-${name}.ttf`,import.meta.url));
const decode = (text:string) => text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');

/** Render the text, paragraph settings and emblem of our two controlled DOCX templates.
 * This is deliberately not a general Word converter: no office process is needed. */
export async function requestTemplatePdf(docx:Buffer):Promise<Buffer> {
  const parts=unzipSync(docx),xml=strFromU8(parts['word/document.xml']!);
  const doc=new PDFDocument({size:'LETTER',margins:{top:39.6,bottom:39.6,left:57.6,right:57.6},compress:true,
    info:{Title:'Демонстрационный документ МУКПиД',Author:'Конкурсный прототип'}});
  const chunks:Buffer[]=[];
  const result=new Promise<Buffer>((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)});
  doc.registerFont('Serif',font('Regular'));doc.registerFont('SerifBold',font('Bold'));
  const width=doc.page.width-doc.page.margins.left-doc.page.margins.right;
  for(const match of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const paragraph=match[1]!;
    if(paragraph.includes('<w:drawing')) {
      const image=parts['word/media/image1.png'];
      if(image){const extent=paragraph.match(/<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);const w=extent?Number(extent[1])/12700:86,h=extent?Number(extent[2])/12700:77;doc.image(Buffer.from(image),(doc.page.width-w)/2,doc.y,{width:w,height:h});doc.y+=h;}
    }
    const text=[...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>/g)].map(m=>m[1]===undefined?'\n':decode(m[1])).join('');
    const props=paragraph.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/)?.[1]??'';
    const spacing=props.match(/<w:spacing\b[^>]*\/>/)?.[0]??'';
    const before=Number(spacing.match(/w:before="(\d+)"/)?.[1]??0)/20,after=Number(spacing.match(/w:after="(\d+)"/)?.[1]??0)/20;
    doc.y+=before;
    if(text.trim()) {
      const runProps=paragraph.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/)?.[1]??'';
      const size=Number(runProps.match(/<w:sz\b[^>]*w:val="(\d+)"/)?.[1]??23)/2;
      const boldTag=runProps.match(/<w:b(?:\s[^>]*)?\/>/)?.[0];
      const bold=!!boldTag&&!/w:val="(?:0|false)"/.test(boldTag);
      const align=(props.match(/<w:jc\b[^>]*w:val="(center|right|left)"/)?.[1]??'left') as 'center'|'right'|'left';
      const line=Number(spacing.match(/w:line="(\d+)"/)?.[1]??240)/240;
      doc.font(bold?'SerifBold':'Serif').fontSize(size).fillColor(size<=8.5?'#666666':'#111111')
        .text(text,doc.page.margins.left,doc.y,{width,align,lineGap:Math.max(0,size*(line-1))});
    }
    doc.y+=after;
  }
  doc.end();return result;
}
