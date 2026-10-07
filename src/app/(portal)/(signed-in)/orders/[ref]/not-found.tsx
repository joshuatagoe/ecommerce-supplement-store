import Link from "next/link";

export default function OrderNotFound() {
  return (
    <>
      <h1>We couldn&apos;t find that order</h1>
      <p>
        It may belong to another provider, or the reference may be mistyped. Start a <Link href="/orders/new">new order</Link>
        .
      </p>
    </>
  );
}
