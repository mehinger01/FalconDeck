"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";

/**
 * Generates a QR code entirely client-side (the `qrcode` package draws
 * directly to a data URL - no network request, no external service). Used
 * by `ResourceOverlay` for both "current lesson resource" and
 * "teacher-entered URL" QR sources, so there's exactly one QR-rendering
 * implementation.
 */
interface QrResult {
  url: string;
  dataUrl: string | null;
  failed: boolean;
}

export function QrCodeDisplay({ url, size = 320 }: { url: string; size?: number }) {
  // Keyed by `url` so a still-in-flight result from a previous `url` is
  // never shown for the current one - avoids resetting state synchronously
  // at the top of the effect (React flags that pattern).
  const [result, setResult] = useState<QrResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      color: { dark: "#2f1d10", light: "#fbf7ee" },
    })
      .then((generated) => {
        if (!cancelled) setResult({ url, dataUrl: generated, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ url, dataUrl: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  const current = result?.url === url ? result : null;
  const dataUrl = current?.dataUrl ?? null;
  const failed = current?.failed ?? false;

  if (failed) {
    return (
      <p className="text-sm text-falcon-cream-200/60" style={{ width: size }}>
        Couldn&rsquo;t generate a QR code for this link.
      </p>
    );
  }

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="animate-pulse rounded-lg bg-falcon-cream-200/10"
        aria-hidden="true"
      />
    );
  }

  return (
    <Image
      src={dataUrl}
      width={size}
      height={size}
      unoptimized
      alt={`QR code linking to ${url}`}
      className="rounded-lg border-4 border-falcon-cream-100 bg-falcon-cream-100 p-2"
    />
  );
}
