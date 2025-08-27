// src/lib/debug.ts
// Назначение: вспомогательные инструменты визуальной отладки взаимодействия со страницей.
// Сюда вынесены:
// - сохранение скриншотов определённых этапов сценария;
// - рисование прямоугольной рамки (bounding box) поверх произвольного элемента.
// Все функции НЕ изменяют поведение основной логики, если флаги отладки выключены.
import { Page, ElementHandle } from 'playwright';
import * as path from 'path';
import { ensureDirs } from './fsutil';
import { log } from './logger';

/**
 * Сохранить скриншот этапа сценария, если отладка включена.
 * @param page Страница Playwright, с которой работаем
 * @param name Понятное имя шага (добавляется к таймстемпу в имени файла)
 * @param enabled Флаг включения; при false функция сразу завершается
 */
export async function debugScreenshot(page: Page, name: string, enabled: boolean) {
  if (!enabled) return;
  const screensDir = path.resolve('debug-artifacts', 'screens');
  await ensureDirs([screensDir]);
  const file = path.resolve(screensDir, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log('Screenshot saved:', file);
}

/**
 * Наложить визуальную рамку (bounding box) поверх элемента на 3 секунды.
 * Удобно, чтобы глазами подтвердить «куда кликнем/что распознано».
 * @param page Текущая страница (непосредственно не используется, но оставлена для симметрии API)
 * @param el Хэндл элемента, вокруг которого рисуем рамку
 * @param color CSS‑цвет рамки с прозрачностью (по умолчанию полупрозрачный красный)
 */
export async function drawBBox(page: Page, el: ElementHandle<Element>, color = 'rgba(255,0,0,.6)') {
  await el.evaluate((node, c) => {
    const r = (node as HTMLElement).getBoundingClientRect();
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed',
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
      background: 'transparent',
      border: `3px solid ${c}`,
      borderRadius: '6px',
      zIndex: '2147483647',
      pointerEvents: 'none'
    } as CSSStyleDeclaration);
    d.setAttribute('data-debug-overlay', '1');
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }, color);
}
