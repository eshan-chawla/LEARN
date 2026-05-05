import { createSupabaseClient } from '@/lib/supabase';

type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface BookRow {
  id: string;
  title: string;
  section_id: string | null;
  file_size: number | null;
  processing_status: ProcessingStatus;
  position: number;
  uploaded_at: string;
}

interface RecordingRow {
  id: string;
  title: string;
  duration: number | null;
  processing_status: ProcessingStatus;
  uploaded_at: string;
}

interface SectionRow {
  id: string;
  title: string;
  position: number;
}

interface StructuralSource {
  pageNumber: null;
  excerpt: string;
  score: number;
  sourceId: string;
  contentType: 'structural';
  title: string;
  startSeconds: null;
  endSeconds: null;
}

function formatDuration(totalSeconds: number | null) {
  if (!totalSeconds || totalSeconds < 0) return '0 minutes';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function countByStatus(rows: Array<{ processing_status: ProcessingStatus }>) {
  return rows.reduce<Record<ProcessingStatus, number>>(
    (counts, row) => ({
      ...counts,
      [row.processing_status]: counts[row.processing_status] + 1,
    }),
    {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    }
  );
}

function formatStatusCounts(counts: Record<ProcessingStatus, number>) {
  return [
    `${counts.completed} completed`,
    `${counts.processing} processing`,
    `${counts.pending} pending`,
    `${counts.failed} failed`,
  ].join(', ');
}

export async function buildClassStructuralContext(accessToken: string, classId: string) {
  const supabase = createSupabaseClient(accessToken);

  const [classResult, sectionsResult, booksResult, recordingsResult] = await Promise.all([
    supabase
      .from('classes')
      .select('id,name,created_at')
      .eq('id', classId)
      .maybeSingle(),
    supabase
      .from('book_sections')
      .select('id,title,position')
      .eq('class_id', classId)
      .order('position', { ascending: true }),
    supabase
      .from('books')
      .select('id,title,section_id,file_size,processing_status,position,uploaded_at')
      .eq('class_id', classId)
      .order('position', { ascending: true }),
    supabase
      .from('recordings')
      .select('id,title,duration,processing_status,uploaded_at')
      .eq('class_id', classId)
      .order('uploaded_at', { ascending: false }),
  ]);

  if (classResult.error) throw classResult.error;
  if (sectionsResult.error) throw sectionsResult.error;
  if (booksResult.error) throw booksResult.error;
  if (recordingsResult.error) throw recordingsResult.error;

  if (!classResult.data) {
    return {
      context: '',
      sources: [] as StructuralSource[],
    };
  }

  const sections = (sectionsResult.data || []) as SectionRow[];
  const books = (booksResult.data || []) as BookRow[];
  const recordings = (recordingsResult.data || []) as RecordingRow[];
  const bookStatusCounts = countByStatus(books);
  const recordingStatusCounts = countByStatus(recordings);
  const knownDurationRecordings = recordings.filter((recording) => typeof recording.duration === 'number');
  const totalRecordingSeconds = knownDurationRecordings.reduce(
    (total, recording) => total + (recording.duration || 0),
    0
  );
  const totalBookBytes = books.reduce((total, book) => total + (book.file_size || 0), 0);

  const booksBySection = sections.map((section) => {
    const sectionBooks = books
      .filter((book) => book.section_id === section.id)
      .sort((left, right) => left.position - right.position);
    return `${section.title}: ${sectionBooks.length} book${sectionBooks.length === 1 ? '' : 's'}${
      sectionBooks.length > 0 ? ` (${sectionBooks.map((book) => book.title).join(', ')})` : ''
    }`;
  });
  const unassignedBooks = books.filter((book) => book.section_id === null);
  if (unassignedBooks.length > 0) {
    booksBySection.push(
      `Unassigned: ${unassignedBooks.length} book${unassignedBooks.length === 1 ? '' : 's'} (${unassignedBooks
        .map((book) => book.title)
        .join(', ')})`
    );
  }

  const recordingLines = recordings.map((recording) =>
    `${recording.title}: ${formatDuration(recording.duration)}; status ${recording.processing_status}; uploaded ${recording.uploaded_at}`
  );
  const bookLines = books.map((book) =>
    `${book.title}: status ${book.processing_status}; file size ${book.file_size || 0} bytes; uploaded ${book.uploaded_at}`
  );

  const context = [
    `Class data snapshot for: ${classResult.data.name}`,
    `Class created at: ${classResult.data.created_at}`,
    '',
    `Total books: ${books.length}`,
    `Book processing statuses: ${formatStatusCounts(bookStatusCounts)}`,
    `Total uploaded book file size: ${totalBookBytes} bytes`,
    `Book sections: ${sections.length}`,
    booksBySection.length > 0 ? `Books by section:\n${booksBySection.join('\n')}` : 'Books by section: none',
    bookLines.length > 0 ? `Book list:\n${bookLines.join('\n')}` : 'Book list: none',
    '',
    `Total videos / lectures / recordings: ${recordings.length}`,
    `Recording processing statuses: ${formatStatusCounts(recordingStatusCounts)}`,
    `Total known recording duration: ${formatDuration(totalRecordingSeconds)} (${totalRecordingSeconds} seconds)`,
    `Recordings with known duration: ${knownDurationRecordings.length}`,
    recordingLines.length > 0 ? `Recording list:\n${recordingLines.join('\n')}` : 'Recording list: none',
  ].join('\n');

  return {
    context,
    sources: [
      {
        pageNumber: null,
        excerpt: [
          `${books.length} books`,
          `${recordings.length} recordings`,
          `${sections.length} book sections`,
          `${formatDuration(totalRecordingSeconds)} total known recording duration`,
        ].join('; '),
        score: 1,
        sourceId: `class-structure:${classId}`,
        contentType: 'structural' as const,
        title: 'Class structure data',
        startSeconds: null,
        endSeconds: null,
      },
    ],
  };
}
