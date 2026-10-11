"use client";

import { useMemo } from "react";
import { encode } from "uqr";
import type { PairingQrDto } from "./whatsapp-api";

// QR de pareamento desenhado no navegador (formato "text") ou a imagem pronta do provedor
// ("data_url"). Módulos em grafite sobre branco, com margem de 2 módulos para a câmera ler.
// O conteúdo é sensível: não vai para atributo de dado, título nem log.
export function QrCode({ qr, label }: { qr: PairingQrDto; label: string }) {
  const path = useMemo(() => {
    if (qr.format !== "text") return null;
    const { data, size } = encode(qr.value, { ecc: "M", border: 2 });
    let d = "";
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
    }
    return { d, size };
  }, [qr.format, qr.value]);

  if (!path) {
    // eslint-disable-next-line @next/next/no-img-element -- data URL do provedor, sem otimização
    return <img src={qr.value} alt={label} className="size-full" />;
  }
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" className="size-full">
      <rect width={path.size} height={path.size} className="fill-surface" />
      <path d={path.d} className="fill-ink" />
    </svg>
  );
}
