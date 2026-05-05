import { ImageResponse } from 'next/og';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #0284c7 100%)',
          color: '#f8fafc',
          display: 'flex',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 64,
          fontWeight: 800,
          height: '100%',
          justifyContent: 'center',
          letterSpacing: '-0.08em',
          width: '100%',
        }}
      >
        SL
      </div>
    ),
    { width: 180, height: 180 }
  );
}
