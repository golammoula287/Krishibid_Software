import { describe, expect, it } from 'vitest';
import { categoryImage, POPULAR_CATEGORIES } from './categoryImage.js';

describe('categoryImage', () => {
  it('returns built-in fallback image for known category slug as string', () => {
    expect(categoryImage('crops')).toBe('/img/produce-spread.webp');
    expect(categoryImage('vegetables')).toBe('/img/cat-vegetables.webp');
  });

  it('returns default fallback for unknown slug', () => {
    expect(categoryImage('non-existent-category')).toBe('/img/cat-mixed.webp');
  });

  it('returns custom image when passed as second argument', () => {
    expect(categoryImage('crops', 'https://res.cloudinary.com/demo/image/upload/custom.jpg')).toBe(
      'https://res.cloudinary.com/demo/image/upload/custom.jpg',
    );
  });

  it('returns custom image when passed in category object', () => {
    expect(
      categoryImage({
        slug: 'crops',
        image: 'https://res.cloudinary.com/demo/image/upload/cat-crops.jpg',
      }),
    ).toBe('https://res.cloudinary.com/demo/image/upload/cat-crops.jpg');
  });

  it('falls back to default image when category object image is empty or undefined', () => {
    expect(categoryImage({ slug: 'crops', image: '' })).toBe('/img/produce-spread.webp');
    expect(categoryImage({ slug: 'crops', image: undefined })).toBe('/img/produce-spread.webp');
    expect(categoryImage({ slug: 'unknown-cat', image: '' })).toBe('/img/cat-mixed.webp');
  });
});
