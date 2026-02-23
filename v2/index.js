#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright");
const PptxGenJS = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SLIDE_W_PX = 1920;
const SLIDE_H_PX = 1080;
const DPI = 96;
const SLIDE_W_IN = SLIDE_W_PX / DPI; // 20
const SLIDE_H_IN = SLIDE_H_PX / DPI; // 11.25

const INPUT_FILE = process.argv[2] || "test.html";
const OUTPUT_FILE = process.argv[3] || "output.pptx";

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || "");
}

// ---------------------------------------------------------------------------
// Helpers (Node-side)
// ---------------------------------------------------------------------------
function pxToInches(px) {
  return px / DPI;
}

function pxToPt(px) {
  return (px * 72) / DPI;
}

function rgbToHex(color) {
  if (!color) return null;
  if (color === "transparent" || color === "rgba(0, 0, 0, 0)") return null;
  const m = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
  );
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.01) return null;
    return (
      parseInt(m[1]).toString(16).padStart(2, "0") +
      parseInt(m[2]).toString(16).padStart(2, "0") +
      parseInt(m[3]).toString(16).padStart(2, "0")
    ).toUpperCase();
  }
  const hm = color.match(/^#([0-9A-Fa-f]{3,8})$/);
  if (hm) {
    let h = hm[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return h.substring(0, 6).toUpperCase();
  }
  return null;
}

function parseRgbaAlpha(color) {
  if (!color) return 1;
  const m = color.match(
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/
  );
  return m ? parseFloat(m[1]) : 1;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function isBold(weight) {
  return parseInt(weight) >= 600;
}

function mapAlign(a) {
  if (a === "center" || a === "right" || a === "justify") return a;
  if (a === "-webkit-center") return "center";
  return "left";
}

function mapValign(v) {
  if (v === "middle" || v === "bottom") return v;
  return "top";
}

function mapDashType(style) {
  switch (style) {
    case "dashed":
      return "dash";
    case "dotted":
      return "dot";
    case "double":
      return "solid"; // PPT doesn't have a double line; we approximate
    default:
      return "solid";
  }
}

const FONT_MAP = {
  Inter: "Calibri",
  Outfit: "Calibri",
  "Segoe UI": "Segoe UI",
  Roboto: "Calibri",
  "Helvetica Neue": "Arial",
  Helvetica: "Arial",
  Arial: "Arial",
  "sans-serif": "Arial",
};

function mapFont(f) {
  const name = (f || "Arial").replace(/['"]/g, "").split(",")[0].trim();
  return FONT_MAP[name] || name;
}

// ---------------------------------------------------------------------------
// Browser-side: Collect rich-text runs from an element (handles <strong>,
// <b>, <em>, <i>, <span>, bare text nodes) so that inline formatting is
// preserved in the PPTX.
// ---------------------------------------------------------------------------
function browserCollectTextRuns(el, inheritedCs) {
  const runs = [];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent;
      // Keep whitespace-only nodes as a single space so words don't merge
      const trimmed = t.trim();
      if (!trimmed) {
        if (t.length > 0 && runs.length > 0) runs.push({ text: " ", inherited: true });
        continue;
      }
      runs.push({ text: trimmed, inherited: true });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      // Skip non-inline elements and SVGs (they are handled separately)
      if (
        tag === "svg" ||
        tag === "img" ||
        tag === "div" ||
        tag === "ul" ||
        tag === "ol" ||
        tag === "table" ||
        tag === "section" ||
        tag === "thead" ||
        tag === "tbody" ||
        tag === "tfoot" ||
        tag === "tr"
      )
        continue;
      // Inline elements: extract styled run
      const cs = window.getComputedStyle(child);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const innerText = child.textContent.trim();
      if (!innerText) continue;
      runs.push({
        text: innerText,
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        color: cs.color,
        textDecoration: cs.textDecorationLine || cs.textDecoration,
      });
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Browser-side: Main DOM traversal function passed to page.evaluate()
// ---------------------------------------------------------------------------
function browserExtractSlides() {
  const slides = document.querySelectorAll(".slide");
  const results = [];

  function isTransparent(c) {
    return !c || c === "rgba(0, 0, 0, 0)" || c === "transparent";
  }

  function hasBg(cs) {
    if (!isTransparent(cs.backgroundColor)) return true;
    return cs.backgroundImage && cs.backgroundImage !== "none";
  }

  function hasBorder(cs) {
    for (const s of ["Top", "Right", "Bottom", "Left"]) {
      if ((parseFloat(cs["border" + s + "Width"]) || 0) > 0 && cs["border" + s + "Style"] !== "none") return true;
    }
    return false;
  }

  function flexValign(parentCs) {
    if (!parentCs || !parentCs.display.includes("flex")) return "top";
    const col = parentCs.flexDirection === "column";
    const prop = col ? parentCs.justifyContent : parentCs.alignItems;
    if (prop === "center" || prop === "space-around") return "middle";
    if (prop === "flex-end" || prop === "end") return "bottom";
    return "top";
  }

  function inferHorizontalAlign(cs) {
    if (!cs) return "left";
    const ta = cs.textAlign;
    if (ta && !["start", "auto", "-webkit-auto"].includes(ta)) return ta;
    const display = cs.display || "";
    if (display.includes("flex")) {
      const jc = cs.justifyContent;
      if (["center", "space-around", "space-between", "space-evenly"].includes(jc)) return "center";
      if (jc === "flex-end" || jc === "end") return "right";
    }
    return ta || "left";
  }

  function inferSelfValign(cs) {
    if (!cs) return null;
    const display = cs.display || "";
    if (!display.includes("flex")) return null;
    const isColumn = cs.flexDirection === "column";
    const primaryAxis = isColumn ? cs.justifyContent : cs.alignItems;
    if (["center", "space-around", "space-between", "space-evenly", "stretch"].includes(primaryAxis)) return "middle";
    if (primaryAxis === "flex-end" || primaryAxis === "end") return "bottom";
    return null;
  }

  // Collect runs helper (inlined for page.evaluate scope)
  function collectRuns(el) {
    const runs = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent;
        const trimmed = t.trim();
        if (!trimmed) {
          if (t.length > 0 && runs.length > 0) runs.push({ text: " ", inherited: true });
          continue;
        }
        runs.push({ text: trimmed, inherited: true });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (
          [
            "svg",
            "img",
            "div",
            "ul",
            "ol",
            "table",
            "section",
            "nav",
            "header",
            "footer",
            "article",
            "thead",
            "tbody",
            "tfoot",
            "tr",
          ].includes(tag)
        )
          continue;
        const cs = window.getComputedStyle(child);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const innerText = child.textContent.trim();
        if (!innerText) continue;
        runs.push({
          text: innerText,
          fontFamily: cs.fontFamily,
          fontSize: parseFloat(cs.fontSize),
          fontWeight: cs.fontWeight,
          fontStyle: cs.fontStyle,
          color: cs.color,
          textDecoration: cs.textDecorationLine || cs.textDecoration,
        });
      }
    }
    return runs;
  }

  for (const slide of slides) {
    const sr = slide.getBoundingClientRect();
    const slideData = {
      items: [],
      slideRect: { x: sr.x, y: sr.y, width: sr.width, height: sr.height },
    };

    const visited = new Set();

    function traverse(el, depth) {
      if (visited.has(el)) return;
      visited.add(el);
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const opacity = parseFloat(cs.opacity);
      if (opacity === 0) return;

      const r = el.getBoundingClientRect();
      const rx = r.x - sr.x, ry = r.y - sr.y, rw = r.width, rh = r.height;
      if (rw < 1 || rh < 1) return;
      if (rx + rw < 0 || ry + rh < 0 || rx > sr.width || ry > sr.height) return;

      const tag = el.tagName.toLowerCase();

      // ---- SVG: mark for screenshot later ----
      if (tag === "svg") {
        slideData.items.push({
          type: "svg_region",
          rect: { x: rx, y: ry, width: rw, height: rh },
          absRect: { x: r.x, y: r.y, width: rw, height: rh },
          zIndex: depth,
          opacity,
        });
        return;
      }

      // ---- <img> ----
      if (tag === "img" && el.src) {
        slideData.items.push({
          type: "image",
          rect: { x: rx, y: ry, width: rw, height: rh },
          src: el.src,
          zIndex: depth,
          opacity,
        });
        return;
      }

      // ---- Visual properties ----
      const bgVisible = hasBg(cs);
      const borderVisible = hasBorder(cs);
      const isVisual = bgVisible || borderVisible;

      const parentCs = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
      let valign = parentCs ? flexValign(parentCs) : "top";
      const selfValign = inferSelfValign(cs);
      if (selfValign) valign = selfValign;
      if (tag === "th" || tag === "td") {
        valign = cs.verticalAlign === "middle" ? "middle" : "top";
      }

      let maskParentRadius = null;
      if (el.parentElement && (parseFloat(cs.borderRadius) || 0) < 1) {
        const parent = el.parentElement;
        const pcs = parentCs || window.getComputedStyle(parent);
        const parentRadius = parseFloat(pcs.borderRadius) || 0;
        const overflowHidden =
          pcs.overflow === "hidden" ||
          pcs.overflow === "clip" ||
          pcs.overflowX === "hidden" ||
          pcs.overflowY === "hidden";
        if (parentRadius > 3 && overflowHidden) {
          const pr = parent.getBoundingClientRect();
          const epsilon = 1.5;
          const touchesLeft = Math.abs(r.x - pr.x) < epsilon;
          const touchesRight = Math.abs(r.x + r.width - (pr.x + pr.width)) < epsilon;
          const touchesTop = Math.abs(r.y - pr.y) < epsilon;
          const touchesBottom = Math.abs(r.y + r.height - (pr.y + pr.height)) < epsilon;
          if (touchesLeft || touchesRight || touchesTop || touchesBottom) {
            maskParentRadius = {
              radius: parentRadius,
              left: touchesLeft,
              right: touchesRight,
              top: touchesTop,
              bottom: touchesBottom,
            };
          }
        }
      }

      // ---- Emit shape ----
      if (isVisual) {
        slideData.items.push({
          type: "shape",
          rect: { x: rx, y: ry, width: rw, height: rh },
          absRect: { x: r.x, y: r.y, width: rw, height: rh },
          backgroundColor: cs.backgroundColor,
          backgroundImage: cs.backgroundImage,
          borderRadius: parseFloat(cs.borderRadius) || 0,
          borderTop: { w: parseFloat(cs.borderTopWidth) || 0, color: cs.borderTopColor, style: cs.borderTopStyle },
          borderRight: { w: parseFloat(cs.borderRightWidth) || 0, color: cs.borderRightColor, style: cs.borderRightStyle },
          borderBottom: { w: parseFloat(cs.borderBottomWidth) || 0, color: cs.borderBottomColor, style: cs.borderBottomStyle },
          borderLeft: { w: parseFloat(cs.borderLeftWidth) || 0, color: cs.borderLeftColor, style: cs.borderLeftStyle },
          zIndex: depth,
          opacity,
          maskParentRadius,
        });
      }

      // ---- Emit text ----
      // Collect rich-text runs from direct children
      const runs = collectRuns(el);
      let emittedInlineText = false;
      if (runs.length > 0) {
        const hasOnlyInherited = runs.every((r) => r.inherited);
        // Only emit if there's actual text that isn't fully covered by child element traversal
        // Check: does the element have child *elements* that are block-level? If so, their text
        // will be collected when we traverse them. Only emit text here if all children are inline.
        let hasBlockChildren = false;
        for (const ch of el.children) {
          const chCs = window.getComputedStyle(ch);
          const childDisplay = chCs.display || "";
          const isBlockish =
            childDisplay === "block" ||
            childDisplay === "flex" ||
            childDisplay === "grid" ||
            childDisplay === "inline-block" ||
            childDisplay === "table" ||
            childDisplay === "table-row" ||
            childDisplay === "table-row-group" ||
            childDisplay === "table-header-group" ||
            childDisplay === "table-footer-group" ||
            childDisplay === "table-column" ||
            childDisplay === "table-column-group" ||
            childDisplay === "table-cell" ||
            childDisplay === "table-caption";
          if (isBlockish) {
            hasBlockChildren = true;
            break;
          }
        }

        if (!hasBlockChildren) {
          slideData.items.push({
            type: "text",
            rect: { x: rx, y: ry, width: rw, height: rh },
            runs: runs,
            fontFamily: cs.fontFamily,
            fontSize: parseFloat(cs.fontSize),
            fontWeight: cs.fontWeight,
            fontStyle: cs.fontStyle,
            color: cs.color,
            textAlign: inferHorizontalAlign(cs),
            verticalAlign: valign,
            letterSpacing: parseFloat(cs.letterSpacing) || 0,
            lineHeight: cs.lineHeight,
            textTransform: cs.textTransform,
            paddingTop: parseFloat(cs.paddingTop) || 0,
            paddingRight: parseFloat(cs.paddingRight) || 0,
            paddingBottom: parseFloat(cs.paddingBottom) || 0,
            paddingLeft: parseFloat(cs.paddingLeft) || 0,
            zIndex: depth + 0.5,
            opacity,
          });
          emittedInlineText = true;
        }
      }

      // ---- Recurse ----
      if (!emittedInlineText) {
        for (let i = 0; i < el.children.length; i++) {
          traverse(el.children[i], depth + 1);
        }
      }
    }

    // Slide background
    const scs = window.getComputedStyle(slide);
    if (hasBg(scs)) {
      slideData.items.push({
        type: "shape",
        rect: { x: 0, y: 0, width: sr.width, height: sr.height },
        absRect: { x: sr.x, y: sr.y, width: sr.width, height: sr.height },
        backgroundColor: scs.backgroundColor,
        backgroundImage: scs.backgroundImage,
        borderRadius: 0,
        borderTop: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
        borderRight: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
        borderBottom: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
        borderLeft: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
        zIndex: 0,
        opacity: parseFloat(scs.opacity) || 1,
      });
    }

    for (let i = 0; i < slide.children.length; i++) {
      traverse(slide.children[i], 1);
    }

    results.push(slideData);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Post-processing: screenshot SVGs and gradient/conic regions from the page
// ---------------------------------------------------------------------------
async function screenshotRegions(page, slidesData) {
  for (let sIdx = 0; sIdx < slidesData.length; sIdx++) {
    const sd = slidesData[sIdx];
    for (let i = 0; i < sd.items.length; i++) {
      const item = sd.items[i];

      const isSvg = item.type === "svg_region";
      const isGradient =
        item.type === "shape" &&
        !item._fromPseudo &&
        item.backgroundImage &&
        (item.backgroundImage.includes("gradient") ||
          item.backgroundImage.includes("url("));

      if (!isSvg && !isGradient) continue;

      const absR = item.absRect || {
        x: sd.slideRect.x + item.rect.x,
        y: sd.slideRect.y + item.rect.y,
        width: item.rect.width,
        height: item.rect.height,
      };
      if (absR.width < 2 || absR.height < 2) continue;

      // SVG regions: direct page screenshot (no text overlap concern)
      if (isSvg) {
        try {
          const buf = await page.screenshot({
            clip: {
              x: Math.max(0, Math.round(absR.x)),
              y: Math.max(0, Math.round(absR.y)),
              width: Math.round(Math.min(absR.width, SLIDE_W_PX)),
              height: Math.round(Math.min(absR.height, SLIDE_H_PX)),
            },
            type: "png",
          });
          item.type = "image";
          item.src = `data:image/png;base64,${buf.toString("base64")}`;
        } catch (_) {
          item.type = "image";
          item.src = null;
        }
        continue;
      }

      // Gradient shapes: create a temporary isolated element with ONLY the
      // background, screenshot it, then remove. Hide the original slide
      // content so translucent gradients don't capture underlying text.
      try {
        const tempId = `__grad_${sIdx}_${i}`;
        await page.evaluate(
          ({ id, ax, ay, aw, ah, bgImage, bgColor, radius }) => {
            const d = document.createElement("div");
            d.id = id;
            d.style.cssText = [
              "position:absolute",
              `left:${ax}px`,
              `top:${ay}px`,
              `width:${aw}px`,
              `height:${ah}px`,
              `background-image:${bgImage}`,
              `background-color:${bgColor || "transparent"}`,
              `border-radius:${radius}px`,
              "z-index:2147483647",
              "pointer-events:none",
            ].join(";");
            document.body.appendChild(d);
          },
          {
            id: tempId,
            ax: absR.x,
            ay: absR.y,
            aw: absR.width,
            ah: absR.height,
            bgImage: item.backgroundImage,
            bgColor: item.backgroundColor,
            radius: item.borderRadius || 0,
          }
        );

        const hideSlides = async (visibility) => {
          await page.evaluate((vis) => {
            document.querySelectorAll(".slide").forEach((slide) => {
              if (slide.dataset.__pptxPrevVis === undefined) {
                slide.dataset.__pptxPrevVis = slide.style.visibility || "";
              }
              slide.style.visibility = vis;
            });
          }, visibility);
        };

        await hideSlides("hidden");
        let buf;
        try {
          buf = await page.screenshot({
            clip: {
              x: Math.max(0, Math.round(absR.x)),
              y: Math.max(0, Math.round(absR.y)),
              width: Math.round(Math.min(absR.width, SLIDE_W_PX)),
              height: Math.round(Math.min(absR.height, SLIDE_H_PX)),
            },
            type: "png",
          });
        } finally {
          await hideSlides("visible");
          await page.evaluate(() => {
            document.querySelectorAll(".slide").forEach((slide) => {
              if (slide.dataset.__pptxPrevVis !== undefined) {
                slide.style.visibility = slide.dataset.__pptxPrevVis;
                delete slide.dataset.__pptxPrevVis;
              }
            });
          });
        }

        await page.evaluate((id) => {
          const el = document.getElementById(id);
          if (el) el.remove();
        }, tempId);

        item._gradientImage = `data:image/png;base64,${buf.toString("base64")}`;
      } catch (_) {
        // Fallback: gradient won't render, solid bg will be used instead
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Post-processing: extract pseudo-element backgrounds
// ---------------------------------------------------------------------------
async function extractPseudoElements(page, slidesData) {
  const all = await page.evaluate(() => {
    const slides = document.querySelectorAll(".slide");
    const result = [];
    slides.forEach((slide) => {
      const sr = slide.getBoundingClientRect();
      const items = [];
      function check(el, pseudo) {
        const cs = window.getComputedStyle(el, pseudo);
        if (!cs.content || cs.content === "none" || cs.content === "normal") return;
        const bg = cs.backgroundColor;
        const bgImg = cs.backgroundImage;
        const hasBg =
          (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") ||
          (bgImg && bgImg !== "none");
        if (!hasBg) return;
        const pr = el.getBoundingClientRect();
        let w = parseFloat(cs.width) || pr.width;
        let h = parseFloat(cs.height) || pr.height;
        let x = pr.x - sr.x;
        let y = pr.y - sr.y;
        if (cs.position === "absolute") {
          if (!isNaN(parseFloat(cs.top))) y += parseFloat(cs.top);
          if (!isNaN(parseFloat(cs.left))) x += parseFloat(cs.left);
        }
        if (w < 2 || h < 2) return;
        items.push({
          type: "shape",
          rect: { x, y, width: w, height: h },
          absRect: { x: sr.x + x, y: sr.y + y, width: w, height: h },
          backgroundColor: bg,
          backgroundImage: bgImg,
          borderRadius: parseFloat(cs.borderRadius) || 0,
          borderTop: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          borderRight: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          borderBottom: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          borderLeft: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          zIndex: -1,
          opacity: parseFloat(cs.opacity) || 1,
          _fromPseudo: true,
        });
      }
      const els = slide.querySelectorAll("*");
      els.forEach((el) => { check(el, "::before"); check(el, "::after"); });
      check(slide, "::before");
      check(slide, "::after");
      result.push(items);
    });
    return result;
  });
  for (let i = 0; i < slidesData.length && i < all.length; i++) {
    for (const item of all[i]) slidesData[i].items.unshift(item);
  }
}

// ---------------------------------------------------------------------------
// Post-processing: extract list bullet pseudo-elements (colored dots)
// ---------------------------------------------------------------------------
async function extractListBullets(page, slidesData) {
  const all = await page.evaluate(() => {
    const slides = document.querySelectorAll(".slide");
    const result = [];
    slides.forEach((slide) => {
      const sr = slide.getBoundingClientRect();
      const items = [];
      slide.querySelectorAll("li").forEach((li) => {
        const cs = window.getComputedStyle(li, "::before");
        if (!cs.content || cs.content === "none" || cs.content === "normal") return;
        const bg = cs.backgroundColor;
        if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") return;
        const lr = li.getBoundingClientRect();
        const w = parseFloat(cs.width) || 12;
        const h = parseFloat(cs.height) || 12;
        const mt = parseFloat(cs.marginTop) || 0;
        if (w < 1 || h < 1) return;
        items.push({
          type: "shape",
          rect: { x: lr.x - sr.x, y: lr.y - sr.y + mt, width: w, height: h },
          backgroundColor: bg,
          backgroundImage: "none",
          borderRadius: parseFloat(cs.borderRadius) || 0,
          borderTop: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          borderRight: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          borderBottom: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          borderLeft: { w: 0, color: "rgba(0,0,0,0)", style: "none" },
          zIndex: 50,
          opacity: 1,
        });
      });
      result.push(items);
    });
    return result;
  });
  for (let i = 0; i < slidesData.length && i < all.length; i++) {
    slidesData[i].items.push(...all[i]);
  }
}

// ---------------------------------------------------------------------------
// Post-processing: screenshot full table regions
// ---------------------------------------------------------------------------
async function screenshotTableRegions(page, slidesData) {
  for (let sIdx = 0; sIdx < slidesData.length; sIdx++) {
    const sd = slidesData[sIdx];
    const rects = await page.evaluate((si) => {
      const slides = document.querySelectorAll(".slide");
      const slide = slides[si];
      if (!slide) return [];
      const sr = slide.getBoundingClientRect();
      const out = [];
      slide.querySelectorAll("table").forEach((table) => {
        const r = table.getBoundingClientRect();
        if (!r || r.width < 2 || r.height < 2) return;
        out.push({ ax: r.x, ay: r.y, rx: r.x - sr.x, ry: r.y - sr.y, w: r.width, h: r.height });
      });
      return out;
    }, sIdx);

    for (const r of rects) {
      if (r.w < 2 || r.h < 2) continue;
      try {
        const clip = {
          x: Math.max(0, r.ax),
          y: Math.max(0, r.ay),
          width: Math.round(Math.min(r.w, SLIDE_W_PX)),
          height: Math.round(Math.min(r.h, SLIDE_H_PX)),
        };
        const buf = await page.screenshot({ clip, type: "png" });
        sd.items.push({
          type: "image",
          rect: { x: r.rx, y: r.ry, width: r.w, height: r.h },
          src: `data:image/png;base64,${buf.toString("base64")}`,
          zIndex: 120,
          opacity: 1,
        });
      } catch (_) {}
    }
  }
}

function getCornerMaskInfo(item) {
  const mask = item.maskParentRadius;
  if (!mask || !mask.radius) return null;
  const radiusPx = Math.min(mask.radius, Math.min(item.rect.width, item.rect.height) / 2);
  if (radiusPx < 1) return null;
  const corners = {
    left: !!mask.left,
    right: !!mask.right,
    top: !!mask.top,
    bottom: !!mask.bottom,
  };
  if (!corners.left && !corners.right && !corners.top && !corners.bottom) return null;
  const needsSquare = !corners.left || !corners.right || !corners.top || !corners.bottom;
  return { radiusPx, corners, needsSquare };
}

function addMaskRect(slide, pres, rect, fill) {
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  if (width < 0.5 || height < 0.5) return;
  const x = pxToInches(clamp(rect.x, 0, SLIDE_W_PX));
  const y = pxToInches(clamp(rect.y, 0, SLIDE_H_PX));
  const w = pxToInches(Math.min(width, SLIDE_W_PX - rect.x));
  const h = pxToInches(Math.min(height, SLIDE_H_PX - rect.y));
  if (w <= 0 || h <= 0) return;
  slide.addShape(pres.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill,
    line: { type: "none" },
  });
}

function applyCornerMaskOverlays(slide, pres, item, maskInfo, fillHex, transparency) {
  if (!maskInfo || !maskInfo.needsSquare || !fillHex) return;
  const fill = { color: fillHex };
  if (transparency > 0) fill.transparency = transparency;
  const radiusX = Math.min(maskInfo.radiusPx, item.rect.width);
  const radiusY = Math.min(maskInfo.radiusPx, item.rect.height);
  if (!maskInfo.corners.left) {
    addMaskRect(slide, pres, { x: item.rect.x, y: item.rect.y, width: radiusX, height: item.rect.height }, fill);
  }
  if (!maskInfo.corners.right) {
    addMaskRect(
      slide,
      pres,
      { x: item.rect.x + item.rect.width - radiusX, y: item.rect.y, width: radiusX, height: item.rect.height },
      fill
    );
  }
  if (!maskInfo.corners.top) {
    addMaskRect(slide, pres, { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: radiusY }, fill);
  }
  if (!maskInfo.corners.bottom) {
    addMaskRect(
      slide,
      pres,
      { x: item.rect.x, y: item.rect.y + item.rect.height - radiusY, width: item.rect.width, height: radiusY },
      fill
    );
  }
}

// ---------------------------------------------------------------------------
// PPTX Generation: Shape
// ---------------------------------------------------------------------------
function addShapeToPptx(slide, item, pres) {
  const x = pxToInches(clamp(item.rect.x, 0, SLIDE_W_PX));
  const y = pxToInches(clamp(item.rect.y, 0, SLIDE_H_PX));
  const w = pxToInches(Math.min(item.rect.width, SLIDE_W_PX - item.rect.x));
  const h = pxToInches(Math.min(item.rect.height, SLIDE_H_PX - item.rect.y));
  if (w <= 0 || h <= 0) return;

  const bT = item.borderTop || { w: 0 };
  const bR = item.borderRight || { w: 0 };
  const bB = item.borderBottom || { w: 0 };
  const bL = item.borderLeft || { w: 0 };

  const maskInfo = getCornerMaskInfo(item);

  // ---- Gradient background → image ----
  if (item._gradientImage) {
    try { slide.addImage({ data: item._gradientImage, x, y, w, h }); } catch (_) {}
    // Overlay border if needed
    addBorderOverlay(slide, pres, x, y, w, h, item, bT, bR, bB, bL);
    return;
  }

  const bgColor = rgbToHex(item.backgroundColor);
  const fillAlpha = parseRgbaAlpha(item.backgroundColor);
  const maxBorderW = Math.max(bT.w, bR.w, bB.w, bL.w);
  const anyBorder = maxBorderW > 0;
  if (!bgColor && !anyBorder) return;

  // Determine border configuration
  const allSame =
    anyBorder &&
    Math.abs(bT.w - bR.w) < 0.5 &&
    Math.abs(bT.w - bB.w) < 0.5 &&
    Math.abs(bT.w - bL.w) < 0.5;

  const isRounded = item.borderRadius > 3;
  const isCircle =
    item.borderRadius >= Math.min(item.rect.width, item.rect.height) / 2 - 2 &&
    Math.abs(item.rect.width - item.rect.height) < 4;

  let effectiveRounded = isRounded;
  let rectRadiusPx = Math.min(item.borderRadius || 0, Math.min(item.rect.width, item.rect.height) / 2);
  if (maskInfo) {
    effectiveRounded = true;
    rectRadiusPx = maskInfo.radiusPx;
  }

  // Build shape options
  const opts = { x, y, w, h };
  if (bgColor) {
    opts.fill = { color: bgColor };
    if (fillAlpha < 1) opts.fill.transparency = Math.round((1 - fillAlpha) * 100);
  } else {
    opts.fill = { type: "none" };
  }

  // Uniform border → use shape line
  if (allSame && anyBorder) {
    const bc = rgbToHex(bT.color);
    if (bc) {
      opts.line = { color: bc, width: pxToPt(bT.w), dashType: mapDashType(bT.style) };
    }
  }

  // Emit shape
  if (isCircle) {
    slide.addShape(pres.ShapeType.ellipse, opts);
  } else if (effectiveRounded) {
    const radiusInches = pxToInches(rectRadiusPx);
    opts.rectRadius = radiusInches;
    slide.addShape(pres.ShapeType.roundRect, opts);
    if (maskInfo) {
      const transparency = fillAlpha < 1 ? Math.round((1 - fillAlpha) * 100) : 0;
      applyCornerMaskOverlays(slide, pres, item, maskInfo, bgColor, transparency);
    }
  } else {
    slide.addShape(pres.ShapeType.rect, opts);
  }

  // Per-side borders if not uniform
  if (anyBorder && !allSame) {
    addBorderOverlay(slide, pres, x, y, w, h, item, bT, bR, bB, bL);
  }
}

function addBorderOverlay(slide, pres, x, y, w, h, item, bT, bR, bB, bL) {
  function addLine(x1, y1, x2, y2, border) {
    if (border.w < 0.5) return;
    const c = rgbToHex(border.color);
    if (!c) return;
    const lw = Math.abs(x2 - x1);
    const lh = Math.abs(y2 - y1);
    slide.addShape(pres.ShapeType.line, {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: lw || 0.001,
      h: lh || 0.001,
      line: { color: c, width: pxToPt(border.w), dashType: mapDashType(border.style) },
      flipV: y2 < y1,
    });
  }
  // Top
  addLine(x, y, x + w, y, bT);
  // Bottom
  addLine(x, y + h, x + w, y + h, bB);
  // Left
  addLine(x, y, x, y + h, bL);
  // Right
  addLine(x + w, y, x + w, y + h, bR);
}

// ---------------------------------------------------------------------------
// PPTX Generation: Text
// ---------------------------------------------------------------------------
function addTextToPptx(slide, item) {
  const padLeft = item.paddingLeft || 0;
  const padRight = item.paddingRight || 0;
  const padTop = item.paddingTop || 0;
  const padBottom = item.paddingBottom || 0;

  let pxX = item.rect.x + padLeft;
  let pxY = item.rect.y + padTop;
  let pxW = item.rect.width - padLeft - padRight;
  let pxH = item.rect.height - padTop - padBottom;

  pxX = clamp(pxX, 0, SLIDE_W_PX);
  pxY = clamp(pxY, 0, SLIDE_H_PX);
  pxW = Math.max(0, Math.min(pxW, SLIDE_W_PX - pxX));
  pxH = Math.max(0, Math.min(pxH, SLIDE_H_PX - pxY));

  const x = pxToInches(pxX);
  const y = pxToInches(pxY);
  const w = pxToInches(pxW);
  const h = pxToInches(pxH);
  if (w <= 0.03 || h <= 0.03) return;

  // Build runs array for PptxGenJS rich text
  const runs = item.runs || [];
  if (runs.length === 0) return;

  const defaultFont = mapFont(item.fontFamily);
  const defaultSize = Math.max(4, Math.round(pxToPt(item.fontSize) * 10) / 10);
  const defaultBold = isBold(item.fontWeight);
  const defaultItalic = item.fontStyle === "italic";
  const defaultColor = rgbToHex(item.color) || "000000";
  const transform = item.textTransform;

  const pptxRuns = [];
  let allEmpty = true;

  for (const run of runs) {
    let text = run.text || "";
    if (transform === "uppercase") text = text.toUpperCase();
    else if (transform === "lowercase") text = text.toLowerCase();
    if (!text) continue;
    allEmpty = false;

    const runOpts = { text };
    if (run.inherited) {
      runOpts.options = {
        fontSize: defaultSize,
        fontFace: defaultFont,
        color: defaultColor,
        bold: defaultBold,
        italic: defaultItalic,
      };
    } else {
      runOpts.options = {
        fontSize: Math.max(4, Math.round(pxToPt(run.fontSize || item.fontSize) * 10) / 10),
        fontFace: mapFont(run.fontFamily || item.fontFamily),
        color: rgbToHex(run.color) || defaultColor,
        bold: isBold(run.fontWeight || item.fontWeight),
        italic: (run.fontStyle || item.fontStyle) === "italic",
      };
      if (run.textDecoration && run.textDecoration.includes("underline")) {
        runOpts.options.underline = { style: "sng" };
      }
    }
    pptxRuns.push(runOpts);
  }

  if (allEmpty) return;

  const margin = [
    pxToInches(item.paddingTop || 0),
    pxToInches(item.paddingRight || 0),
    pxToInches(item.paddingBottom || 0),
    pxToInches(item.paddingLeft || 0),
  ];

  try {
    slide.addText(pptxRuns, {
      x,
      y,
      w,
      h,
      align: mapAlign(item.textAlign),
      valign: mapValign(item.verticalAlign),
      wrap: true,
      shrinkText: true,
      margin,
      paraSpaceBefore: 0,
      paraSpaceAfter: 0,
      lineSpacingMultiple: 1.0,
      transparency: item.opacity < 0.3 ? Math.round((1 - item.opacity) * 100) : 0,
    });
  } catch (e) {
    console.warn(`  Text failed:`, e.message);
  }
}

// ---------------------------------------------------------------------------
// PPTX Generation: Image
// ---------------------------------------------------------------------------
function addImageToPptx(slide, item) {
  const x = pxToInches(clamp(item.rect.x, 0, SLIDE_W_PX));
  const y = pxToInches(clamp(item.rect.y, 0, SLIDE_H_PX));
  const w = pxToInches(Math.min(item.rect.width, SLIDE_W_PX - item.rect.x));
  const h = pxToInches(Math.min(item.rect.height, SLIDE_H_PX - item.rect.y));
  if (w <= 0 || h <= 0 || !item.src) return;

  const opts = { x, y, w, h };
  if (item.src.startsWith("data:")) opts.data = item.src;
  else opts.path = item.src;

  try {
    slide.addImage(opts);
  } catch (e) {
    console.warn(`  Image failed:`, e.message);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const inputIsUrl = isHttpUrl(INPUT_FILE);
  const inputPath = inputIsUrl ? null : path.resolve(INPUT_FILE);
  if (!inputIsUrl && !fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }
  const allowedOrigin = process.env.ALLOWED_ORIGIN || null;
  const inputTarget = inputIsUrl ? INPUT_FILE : `file://${inputPath}`;

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   HTML → PowerPoint Converter v2.0       ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  console.log(`Input:  ${inputIsUrl ? INPUT_FILE : inputPath}`);
  console.log(`Output: ${path.resolve(OUTPUT_FILE)}\n`);

  // 1. Launch browser
  console.log("1. Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: SLIDE_W_PX, height: SLIDE_H_PX * 20 },
    deviceScaleFactor: 1,
  });

  if (allowedOrigin) {
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (
        requestUrl.startsWith(allowedOrigin) ||
        requestUrl.startsWith("data:") ||
        requestUrl.startsWith("blob:") ||
        requestUrl.startsWith("about:")
      ) {
        await route.continue();
        return;
      }
      await route.abort();
    });
  }

  const page = await context.newPage();

  console.log("2. Loading HTML...");
  await page.goto(inputTarget, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  // 2. DOM extraction
  console.log("3. Extracting DOM layout & styles...");
  const slidesData = await page.evaluate(browserExtractSlides);
  console.log(`   Found ${slidesData.length} slides`);
  slidesData.forEach((s, i) => console.log(`   Slide ${i + 1}: ${s.items.length} items`));

  // 3. Pseudo-elements & bullets
  console.log("4. Extracting pseudo-elements & bullets...");
  await extractPseudoElements(page, slidesData);
  await extractListBullets(page, slidesData);

  // 4. Screenshot SVGs, gradients, conic-gradients
  console.log("5. Screenshotting SVGs & gradient regions...");
  await screenshotRegions(page, slidesData);

  // 5. Screenshot table regions
  console.log("6. Screenshotting table regions...");
  await screenshotTableRegions(page, slidesData);

  await browser.close();
  console.log("   Browser closed.");

  // 6. Generate PPTX
  console.log("7. Generating PowerPoint...");
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "CUSTOM_16x9", width: SLIDE_W_IN, height: SLIDE_H_IN });
  pres.layout = "CUSTOM_16x9";

  for (let sIdx = 0; sIdx < slidesData.length; sIdx++) {
    const sd = slidesData[sIdx];
    console.log(`   Slide ${sIdx + 1} (${sd.items.length} items)...`);
    const slide = pres.addSlide();

    // Sort by z-order
    sd.items.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    for (const item of sd.items) {
      try {
        if (item.type === "shape") addShapeToPptx(slide, item, pres);
        else if (item.type === "text") addTextToPptx(slide, item);
        else if (item.type === "image") addImageToPptx(slide, item);
      } catch (e) {
        console.warn(`   [${item.type}] ${e.message}`);
      }
    }
  }

  // 7. Save
  const outputPath = path.resolve(OUTPUT_FILE);
  console.log(`8. Saving → ${outputPath}`);
  await pres.writeFile({ fileName: outputPath });
  console.log(`\n✅ Done! ${slidesData.length} slides → ${outputPath}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
