import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const subject = request.nextUrl.searchParams.get('subject');

  if (!subject) {
    return NextResponse.json({ error: 'Subject parameter required' }, { status: 400 });
  }

  try {
    const imagesDir = path.join(process.cwd(), 'public', 'images', subject);

    // Check if directory exists
    if (!fs.existsSync(imagesDir)) {
      return NextResponse.json({ images: [] });
    }

    // Read all files from the directory
    const files = fs.readdirSync(imagesDir);

    // Filter for image files (webp, png, jpg, etc.) and sort
    const imageFiles = files
      .filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return ['.webp', '.png', '.jpg', '.jpeg', '.gif'].includes(ext);
      })
      .sort()
      .map((file) => `/images/${subject}/${file}`);

    return NextResponse.json({ images: imageFiles });
  } catch (error) {
    console.error('Error reading images directory:', error);
    return NextResponse.json({ error: 'Failed to load images' }, { status: 500 });
  }
}
