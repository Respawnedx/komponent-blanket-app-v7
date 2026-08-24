// Checkbox detection helpers for paper scans.
// This is not text OCR; it detects marked checkbox centers by image darkness.
(function(){
  const root = window.KomponentDB = window.KomponentDB || {};

  function loadImageFromFile(file){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function cropToContent(srcCanvas){
    const ctx = srcCanvas.getContext("2d", { willReadFrequently:true });
    const { width, height } = srcCanvas;
    const data = ctx.getImageData(0,0,width,height).data;

    const WHITE_LUM = 245;
    const STRIDE = 2;
    let minX = width, minY = height, maxX = -1, maxY = -1;

    for(let y=0;y<height;y+=STRIDE){
      for(let x=0;x<width;x+=STRIDE){
        const i = (y*width + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        const lum = 0.2126*r + 0.7152*g + 0.0722*b;
        if(lum < WHITE_LUM){
          if(x < minX) minX = x;
          if(y < minY) minY = y;
          if(x > maxX) maxX = x;
          if(y > maxY) maxY = y;
        }
      }
    }

    if(maxX < 0) return srcCanvas;

    const pad = Math.round(Math.min(width, height) * 0.02) + 12;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width-1, maxX + pad);
    maxY = Math.min(height-1, maxY + pad);

    const cw = Math.max(1, maxX - minX + 1);
    const ch = Math.max(1, maxY - minY + 1);

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const octx = out.getContext("2d", { willReadFrequently:true });
    octx.drawImage(srcCanvas, minX, minY, cw, ch, 0, 0, cw, ch);

    return out;
  }

  function avgLum(ctx, x, y, w, h){
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const img = ctx.getImageData(x, y, w, h).data;
    let sum = 0;
    for(let i=0;i<img.length;i+=4){
      const lum = 0.2126*img[i] + 0.7152*img[i+1] + 0.0722*img[i+2];
      sum += lum;
    }
    return sum / (img.length/4);
  }

  function detectCheckedCodesFromCanvas(canvas, paperEl){
    const ctx = canvas.getContext("2d", { willReadFrequently:true });

    const cbs = Array.from(paperEl.querySelectorAll(".cb"));
    const pr = paperEl.getBoundingClientRect();

    const detected = [];
    const CENTER_SIZE = 12;
    const OUT_SIZE = 12;
    const OUT_DIST = 18;
    const DELTA = 14;

    for(const cb of cbs){
      const r = cb.getBoundingClientRect();

      const cx = (r.left - pr.left) + r.width/2;
      const cy = (r.top  - pr.top)  + r.height/2;

      const centerAvg = avgLum(ctx, cx - CENTER_SIZE/2, cy - CENTER_SIZE/2, CENTER_SIZE, CENTER_SIZE);

      const out1 = avgLum(ctx, cx - OUT_SIZE/2, cy - OUT_SIZE/2 - OUT_DIST, OUT_SIZE, OUT_SIZE);
      const out2 = avgLum(ctx, cx - OUT_SIZE/2, cy - OUT_SIZE/2 + OUT_DIST, OUT_SIZE, OUT_SIZE);
      const out3 = avgLum(ctx, cx - OUT_SIZE/2 - OUT_DIST, cy - OUT_SIZE/2, OUT_SIZE, OUT_SIZE);
      const out4 = avgLum(ctx, cx - OUT_SIZE/2 + OUT_DIST, cy - OUT_SIZE/2, OUT_SIZE, OUT_SIZE);
      const outAvg = (out1 + out2 + out3 + out4) / 4;

      if((outAvg - centerAvg) > DELTA){
        detected.push(cb.dataset.code);
      }
    }

    return detected.sort((a,b)=>parseInt(a,10)-parseInt(b,10));
  }

  root.scan = {
    loadImageFromFile,
    cropToContent,
    detectCheckedCodesFromCanvas,
  };
})();
