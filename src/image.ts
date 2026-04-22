import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { WAMessage } from '@whiskeysockets/baileys';

import { OLLAMA_HOST } from './config.js';

const MAX_DIMENSION = 1024;
const IMAGE_REF_PATTERN = /\[Image: (attachments\/[^\]]+)\]/g;
const VISION_MODEL = 'gemma3:4b';
const VISION_TIMEOUT_MS = 30000;

export interface ProcessedImage {
  content: string;
  relativePath: string;
}

export interface ImageAttachment {
  relativePath: string;
  mediaType: string;
}

export function isImageMessage(msg: WAMessage): boolean {
  return !!msg.message?.imageMessage;
}

async function describeImageWithVision(
  imageBase64: string,
  caption: string,
): Promise<string | null> {
  if (!OLLAMA_HOST) return null;
  const prompt = caption
    ? `Describe this image in detail. The sender also wrote: "${caption}"`
    : 'Describe this image in detail.';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        stream: false,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageBase64],
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function processImage(
  buffer: Buffer,
  groupDir: string,
  caption: string,
): Promise<ProcessedImage | null> {
  if (!buffer || buffer.length === 0) return null;

  const resized = await sharp(buffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, resized);

  const relativePath = `attachments/${filename}`;

  const imageBase64 = resized.toString('base64');
  const description = await describeImageWithVision(imageBase64, caption);

  let content: string;
  if (description) {
    content = caption
      ? `[Image description: ${description}] (caption: "${caption}")`
      : `[Image description: ${description}]`;
  } else {
    content = caption
      ? `[Image: ${relativePath}] ${caption}`
      : `[Image: ${relativePath}]`;
  }

  return { content, relativePath };
}

export function parseImageReferences(
  messages: Array<{ content: string }>,
): ImageAttachment[] {
  const refs: ImageAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    IMAGE_REF_PATTERN.lastIndex = 0;
    while ((match = IMAGE_REF_PATTERN.exec(msg.content)) !== null) {
      // Always JPEG — processImage() normalizes all images to .jpg
      refs.push({ relativePath: match[1], mediaType: 'image/jpeg' });
    }
  }
  return refs;
}
