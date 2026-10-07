import Image from "next/image";

/** Our own illustrated bottles (D15), with the product's alt text. */
export function ProductImage({ src, alt, size = 64 }: { src: string; alt: string; size?: number }) {
  return <Image src={src} alt={alt} width={size} height={size} unoptimized />;
}
