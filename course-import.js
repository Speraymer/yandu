import {getDocument, GlobalWorkerOptions} from './pdfjs/pdf.min.mjs';

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
      pages.push({text, image:await imageBlob(canvas)});
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally { await task.destroy(); }
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
      const handle = renderSlide(model, slide, {externalMedia:'block', pdfjs:{
        moduleUrl:asset('./pdfjs/pdf.min.mjs'), workerUrl:GlobalWorkerOptions.workerSrc}});
      try {
        stage.replaceChildren(handle.element);
        await handle.ready;
        await Promise.all(Array.from(handle.element.querySelectorAll('img'), img => img.decode().catch(() => {})));
        await document.fonts.ready;
        const canvas = await window.htmlToImage.toCanvas(handle.element, {
          skipFonts:true, backgroundColor:'#ffffff', pixelRatio:1800 / Math.max(model.width,model.height)
        });
        pages.push({text:lines[index].join('\n'), image:await imageBlob(canvas)});
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
