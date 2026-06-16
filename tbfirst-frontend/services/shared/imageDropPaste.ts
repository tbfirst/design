import type React from 'react';

/** 从拖拽事件里取出所有图片文件（已过滤非图片） */
export function imageFilesFromDrop(e: React.DragEvent): File[] {
  const list = e.dataTransfer?.files;
  const out: File[] = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i++) {
    const f = list.item(i);
    if (f && f.type.indexOf('image') !== -1) out.push(f);
  }
  return out;
}

/** 从粘贴事件里取出所有图片文件（已过滤非图片） */
export function imageFilesFromPaste(e: React.ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file' && it.type.indexOf('image') !== -1) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

/**
 * 给「图片上传框」批量挂上 拖拽 + 粘贴 处理（统一入口）。
 * onFiles 收到图片文件数组；single=true 时只取第一张。
 * 用法：<div tabIndex={0} {...imageDropPaste(files => processFiles(files))} />
 */
export function imageDropPaste(
  onFiles: (files: File[]) => void,
  opts: { single?: boolean } = {},
): Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDrop' | 'onPaste'> {
  const take = (files: File[]) => {
    if (files.length === 0) return;
    onFiles(opts.single ? files.slice(0, 1) : files);
  };
  return {
    onDragOver: (e) => { e.preventDefault(); },
    onDrop: (e) => {
      const files = imageFilesFromDrop(e);
      if (files.length) { e.preventDefault(); take(files); }
    },
    onPaste: (e) => {
      const files = imageFilesFromPaste(e);
      if (files.length) { e.preventDefault(); take(files); }
    },
  };
}
