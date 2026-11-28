import {capturePptxLinks,linkRects,linkTarget} from './course-links.js';
import {captureText} from './slide-text.js';
import {getDocument, GlobalWorkerOptions, TextLayer} from './pdfjs/pdf.min.mjs';

const asset = path => new URL(path, import.meta.url).href;
GlobalWorkerOptions.workerSrc = asset('./pdfjs/pdf.worker.min.mjs');

function imageBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) :
    reject(Error('无法保存这一页的画面。')), 'image/webp', 0.94));
}

async function pdfPages(bytes, progress) {
  const task = getDocument({data:bytes, isEvalSupported:false,
    cMapUrl:asset('./pdfjs/cmaps/'), cMapPacked:true, standardFontDataUrl:asset('./pdfjs/standard_fonts/'),
    wasmUrl:asset('./pdfjs/wasm/'), iccUrl:asset('./pdfjs/iccs/')});
  const pdf = await task.promise;
  const pages = [];
  const stage=document.createElement('div');stage.className='import-stage';stage.inert=true;document.body.append(stage);
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(n, pdf.numPages);
      const page = await pdf.getPage(n);
      const base = page.getViewport({scale:1});
      const viewport = page.getViewport({scale:1800 / Math.max(base.width, base.height)});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({canvas, viewport}).promise;
      const content = await page.getTextContent();
      const text = content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim();
      stage.style.width=viewport.width+'px';stage.style.height=viewport.height+'px';
      stage.style.setProperty('--total-scale-factor',viewport.scale);
      const layer=document.createElement('div');layer.className='textLayer';stage.replaceChildren(layer);
      await new TextLayer({container:layer,viewport,textContentSource:content}).render();
      const links=[];
      for (const a of await page.getAnnotations()) {
        if (a.subtype!=='Link' || !a.rect) continue;
        let nav;
        if (a.url || a.unsafeUrl) nav={url:a.url || a.unsafeUrl};
        else if (a.dest) {
          const dest=typeof a.dest==='string'?await pdf.getDestination(a.dest):a.dest;
          if (dest?.length) nav={slideIndex:typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0])};
        } else if (a.action) {
          const index={FirstPage:0,LastPage:pdf.numPages-1,NextPage:n,PrevPage:n-2}[a.action];
          if (index!==undefined) nav={slideIndex:index};
        }
        const [x1,y1]=viewport.convertToViewportPoint(a.rect[0],a.rect[1]);
        const [x2,y2]=viewport.convertToViewportPoint(a.rect[2],a.rect[3]);
        links.push(...linkRects([{left:Math.min(x1,x2),top:Math.min(y1,y2),right:Math.max(x1,x2),bottom:Math.max(y1,y2)}],
          {left:0,top:0,width:viewport.width,height:viewport.height},linkTarget(nav,pdf.numPages),a.title || ''));
      }
      pages.push({text,layout:captureText(stage),links,linksVersion:1,image:await imageBlob(canvas)});
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally { stage.remove();await task.destroy(); }
  return pages;
}

async function pptxPages(bytes, progress) {
  const {parseZip, RECOMMENDED_ZIP_LIMITS, buildPresentation, buildTextIndex, renderSlide} =
    await import('./course-vendor/pptx/renderer.mjs');
  const model = buildPresentation(await parseZip(bytes, RECOMMENDED_ZIP_LIMITS));
  const lines = model.slides.map(() => []);
  for (const entry of buildTextIndex(model)) lines[entry.slideIndex].push(entry.text);
  const pages = [];
  const stage = document.createElement('div');
  stage.className = 'import-stage';
  stage.inert = true;
  document.body.append(stage);
  try {
    for (const [index, slide] of model.slides.entries()) {
      progress(index + 1, model.slides.length);
      let navigation;
      const handle = renderSlide(model, slide, {externalMedia:'block',onNavigate:nav=>{navigation=nav;}, pdfjs:{
        moduleUrl:asset('./pdfjs/pdf.min.mjs'), workerUrl:GlobalWorkerOptions.workerSrc}});
      try {
        stage.replaceChildren(handle.element);
        await handle.ready;
        await Promise.all(Array.from(handle.element.querySelectorAll('img'), img => img.decode().catch(() => {})));
        await document.fonts.ready;
        const canvas = await window.htmlToImage.toCanvas(handle.element, {
          skipFonts:true, backgroundColor:'#ffffff', pixelRatio:1800 / Math.max(model.width,model.height)
        });
        const links=capturePptxLinks(handle.element,model.slides.length,(...args)=>args.length?(navigation=args[0]):navigation);
        pages.push({text:lines[index].join('\n'),layout:captureText(handle.element),links,linksVersion:1,image:await imageBlob(canvas)});
        canvas.width = canvas.height = 0;
      } finally { handle.dispose(); }
    }
  } finally { stage.remove(); }
  return pages;
}

export async function readSlides(file, progress) {
  if (/\.ppt$/i.test(file.name)) throw Error('旧版 .ppt 请用 PowerPoint 或 WPS 另存为 .pptx 或 PDF。');
  if (!/\.(pdf|pptx)$/i.test(file.name)) throw Error('请选择 PPTX 或 PDF 课件。');
  const bytes = await file.arrayBuffer();
  const pages = /\.pdf$/i.test(file.name) ? await pdfPages(bytes, progress) : await pptxPages(bytes, progress);
  if (!pages.length) throw Error('课件中没有可阅读的页面。');
  return pages;
}
