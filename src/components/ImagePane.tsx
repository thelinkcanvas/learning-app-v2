'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';

interface ImagePaneProps {
  subject: string;
}

export default function ImagePane({ subject }: ImagePaneProps) {
  const [images, setImages] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load images for the subject from /public/images/[subject]/
    const loadImages = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch list of images (we'll need to implement an API route for this)
        const response = await fetch(`/api/images?subject=${subject}`);
        if (!response.ok) {
          // If no API available, just set a placeholder
          setImages([`/images/${subject}/placeholder.webp`]);
          setIsLoading(false);
          return;
        }

        const data = await response.json();
        setImages(data.images || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load images');
        // Fallback: try to display a placeholder
        setImages([`/images/${subject}/placeholder.webp`]);
      } finally {
        setIsLoading(false);
      }
    };

    loadImages();
  }, [subject]);

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
        <p className="text-gray-500">教材を読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-red-50 rounded-lg">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    );
  }

  const currentImage = images[currentImageIndex];

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-md p-4">
      {/* Image Display */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 rounded mb-4 min-h-0">
        {currentImage ? (
          <div className="relative w-full h-full">
            <Image
              src={currentImage}
              alt={`教材 ${currentImageIndex + 1}`}
              fill
              className="object-contain"
              priority
            />
          </div>
        ) : (
          <p className="text-gray-400">教材画像がありません</p>
        )}
      </div>

      {/* Navigation - Touch-friendly */}
      <div className="flex items-center justify-between gap-3 mt-4">
        <button
          onClick={goToPrevious}
          disabled={images.length <= 1}
          className="px-4 md:px-6 py-3 md:py-4 bg-gray-300 hover:bg-gray-400 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-base md:text-lg font-medium transition active:scale-95"
        >
          ← 前へ
        </button>

        <p className="text-base md:text-lg font-medium text-gray-700">
          {images.length > 0 ? `${currentImageIndex + 1} / ${images.length}` : '画像なし'}
        </p>

        <button
          onClick={goToNext}
          disabled={images.length <= 1}
          className="px-4 md:px-6 py-3 md:py-4 bg-gray-300 hover:bg-gray-400 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-base md:text-lg font-medium transition active:scale-95"
        >
          次へ →
        </button>
      </div>
    </div>
  );
}
