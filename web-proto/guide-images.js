const imageTypes = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

export function guideImageType(name) {
  if (!name || name.startsWith('.') || /[/\\\x00]/.test(name)) return;
  const dot = name.lastIndexOf('.');
  if (dot > 0) return imageTypes.get(name.slice(dot).toLowerCase());
}

export function isGuideImageSegment(name) {
  return Boolean(name) && !name.startsWith('.') && !/[/\\:?#\x00]/.test(name);
}

export function nestedGuideImageType(path) {
  const [directory, article, filename, extra] = path.split('/');
  if (directory === 'images' && extra === undefined
    && isGuideImageSegment(article) && isGuideImageSegment(filename)) {
    return guideImageType(filename);
  }
}
