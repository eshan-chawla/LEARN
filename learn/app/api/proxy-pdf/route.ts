import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pdfUrl = searchParams.get('url');

    if (!pdfUrl) {
      return NextResponse.json(
        { error: 'Missing url parameter' },
        { status: 400 }
      );
    }

    // Fetch the PDF from the signed URL
    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }

    // Get the PDF blob
    const pdfBlob = await response.blob();

    // Return the PDF with proper headers
    return new NextResponse(pdfBlob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to proxy PDF';
    console.error('Error proxying PDF:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
