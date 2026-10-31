import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {unzipSync,strFromU8,zipSync,strToU8} from 'fflate';
import {analyzeEpub,toEpub} from '../src/main/epub';
import {readBook as readEpub} from '../src/main/epub-reader';

const LOREM='Era uma vez um texto corrido que ocupa a largura da coluna inteira e continua por várias linhas seguidas para formar um parágrafo de verdade.';
async function sample() {
 const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.TimesRoman),bold=await pdf.embedFont(StandardFonts.TimesRomanBold);
 for(const [n,title] of ['Capítulo Um','Capítulo Dois'].entries()){
  for(let k=0;k<2;k++){
   const page=pdf.addPage([420,595]);
   page.drawText('Livro de Teste',{x:40,y:565,size:8,font:regular});
   page.drawText(String(n*2+k+1),{x:205,y:25,size:8,font:regular});
   let y=520;
   if(k===0){page.drawText(title,{x:40,y,size:22,font:bold});y-=40;}
   for(let line=0;line<10;line++){page.drawText(LOREM.slice(0,62),{x:40,y,size:11,font:regular});y-=15;}
   if(n===0&&k===0){page.drawText('Frase com nota',{x:40,y,size:11,font:regular});page.drawText('1',{x:118,y:y+5,size:7,font:regular});y-=15;
    page.drawText('1 Esta é a nota de rodapé explicativa.',{x:40,y:60,size:8,font:regular});}
  }
 }
 return pdf.save();
}

test('PDF → EPUB: chapters from headings, linked footnotes, metadata and repeated headers removed',async()=>{
 const bytes=await sample(),analysis=await analyzeEpub(bytes);
 assert.deepEqual(analysis.chapters.map(c=>[c.title,c.page]),[['Capítulo Um',0],['Capítulo Dois',2]]);
 assert.equal(analysis.footnotes,1);
 const epub=await toEpub(bytes,{title:'Livro de Teste',author:'Ana Maria Souza',year:'2026',genre:'Romance, Ficção',language:'pt-BR',chapters:analysis.chapters});
 const files=unzipSync(epub),names=Object.keys(files);
 assert.equal(names[0],'mimetype');
 const opf=strFromU8(files['OEBPS/content.opf']!);
 assert.match(opf,/<dc:creator id="autor">Ana Maria Souza<\/dc:creator>/);
 assert.match(opf,/<meta refines="#autor" property="file-as">Souza, Ana Maria<\/meta>/);
 assert.match(opf,/<dc:date>2026<\/dc:date>/);
 assert.match(opf,/<dc:subject>Ficção<\/dc:subject>/);
 const first=strFromU8(files['OEBPS/text/cap001.xhtml']!);
 assert.match(first,/<h1>Capítulo Um<\/h1>/);
 assert.match(first,/epub:type="noteref" href="#fn-([^"]+)" id="ref-\1"/);
 assert.match(first,/<aside class="footnote" epub:type="footnote" id="fn-[^"]+"><p><a class="backlink" href="#ref-/);
 assert.match(first,/Esta é a nota de rodapé explicativa\./);
 assert.doesNotMatch(first,/Livro de Teste/,'the running header is not book text');
 assert.match(strFromU8(files['OEBPS/text/sumario.xhtml']!),/Capítulo Dois/);
 // The reader opens what the converter writes.
 const book=readEpub(epub);
 assert.equal(book.title,'Livro de Teste');
 assert.equal(book.author,'Ana Maria Souza');
 assert.ok(book.toc.some(t=>t.title==='Capítulo Dois'));
});

test('EPUB reader removes active content and keeps CSS inside its style element',()=>{
 const epub=zipSync({
  mimetype:strToU8('application/epub+zip'),
  'META-INF/container.xml':strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
  'c.opf':strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>X</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="s" href="s.css" media-type="text/css"/></manifest><spine><itemref idref="a"/></spine></package>'),
  's.css':strToU8('p{color:red}</style><img src=x onerror=alert(1)><style>'),
  'a.xhtml':strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="s.css"/></head><body><p id="n" onclick="x()">Oi</p><p><![CDATA[x><img src=x onerror=alert(1)>]]></p><!-- c --><script>alert(1)</script><a href="https://exemplo.com">site</a><iframe src="https://x"/></body></html>'),
 });
 const book=readEpub(epub);
 assert.ok(!book.css.includes('<'),book.css);
 assert.doesNotMatch(book.html,/script|onclick|iframe|href="https/i);
 assert.doesNotMatch(book.html,/<img|CDATA|<!--/);
 assert.match(book.html,/x&gt;&lt;img/);
 assert.match(book.html,/id="c0-n"/);
 assert.match(book.html,/data-external="https:\/\/exemplo.com"/);
});
