'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';
import { PdfUploadModal } from '@/components/PdfUploadModal';
import { VideoUploadModal } from '@/components/VideoUploadModal';
import { ProcessingStatusBadge } from '@/components/ProcessingStatusBadge';
import Link from 'next/link';

interface Class {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  user_id: string;
  slug?: string | null;
}

interface Recording {
  id: string;
  class_id: string;
  title: string;
  video_url: string;
  storage_path: string | null;
  duration: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  uploaded_at: string;
}

interface BookSection {
  id: string;
  class_id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface Book {
  id: string;
  class_id: string;
  section_id: string | null;
  title: string;
  pdf_url: string;
  file_size: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  storage_path: string | null;
  position: number;
  uploaded_at: string;
}

interface Note {
  id: string;
  class_id: string;
  user_id: string;
  content: string | null;
  updated_at: string;
}

type ClassRole = 'owner' | 'manager' | 'student';

interface ClassMember {
  user_id: string;
  email: string;
  name: string;
  role: ClassRole;
  created_at: string;
}

interface BookUploadTarget {
  sectionId: string | null;
  startingPosition: number;
}

interface OrganizedBookSection extends BookSection {
  books: Book[];
}

interface DraggedBook {
  bookId: string;
  fromSectionId: string | null;
}

interface BookDropTarget {
  sectionId: string | null;
  targetBookId: string | null;
  placement: 'before' | 'after' | 'inside';
}

interface SectionDropTarget {
  sectionId: string;
  placement: 'before' | 'after';
}

type TabType = 'recordings' | 'books' | 'notes' | 'students';

const memberRoleStyles: Record<ClassRole, { label: string; className: string }> = {
  owner: {
    label: 'Owner',
    className: 'bg-amber-100 text-amber-800',
  },
  manager: {
    label: 'Manager',
    className: 'bg-blue-100 text-blue-700',
  },
  student: {
    label: 'Student',
    className: 'bg-gray-100 text-gray-700',
  },
};

const recordingStatusStyles: Record<Recording['processing_status'], { label: string; className: string; icon: ReactNode }> = {
  pending: {
    label: 'Queued',
    className: 'bg-gray-100 text-gray-700',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  processing: {
    label: 'Processing',
    className: 'bg-blue-100 text-blue-700',
    icon: (
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    ),
  },
  completed: {
    label: 'Ready',
    className: 'bg-green-100 text-green-700',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
};

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDuration(duration: number | null) {
  if (!duration || duration < 0) return '—';

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }

    if ('details' in error) {
      const details = (error as { details?: unknown }).details;
      if (typeof details === 'string' && details.trim()) return details;
    }

    if ('hint' in error) {
      const hint = (error as { hint?: unknown }).hint;
      if (typeof hint === 'string' && hint.trim()) return hint;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Ignore serialization issues and use fallback below.
    }
  }

  return fallback;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function compareSections(a: BookSection, b: BookSection) {
  return a.position - b.position || a.title.localeCompare(b.title);
}

function compareBooks(a: Book, b: Book) {
  return a.position - b.position || new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime();
}

export default function ClassPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;

  const [classData, setClassData] = useState<Class | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('recordings');
  const [loading, setLoading] = useState(true);
  const [classRole, setClassRole] = useState<ClassRole | null>(null);

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [bookSections, setBookSections] = useState<BookSection[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [bookUploadTarget, setBookUploadTarget] = useState<BookUploadTarget | null>(null);
  const [videoUploadModalOpen, setVideoUploadModalOpen] = useState(false);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ memberId: string; top: number; left: number } | null>(null);
  const [transferOwnershipTarget, setTransferOwnershipTarget] = useState<ClassMember | null>(null);
  const [transferOwnershipEmail, setTransferOwnershipEmail] = useState('');
  const [transferOwnershipError, setTransferOwnershipError] = useState<string | null>(null);

  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [creatingSection, setCreatingSection] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<SectionDropTarget | null>(null);
  const [editingRecordingId, setEditingRecordingId] = useState<string | null>(null);
  const [recordingTitleDraft, setRecordingTitleDraft] = useState('');
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookTitleDraft, setBookTitleDraft] = useState('');
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [draggedBook, setDraggedBook] = useState<DraggedBook | null>(null);
  const [bookDropTarget, setBookDropTarget] = useState<BookDropTarget | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const draggedBookRef = useRef<DraggedBook | null>(null);
  const memberMenuRef = useRef<HTMLDivElement | null>(null);
  const noteContentRef = useRef('');
  const currentNoteContentRef = useRef('');
  const classIdRef = useRef<string | null>(null);
  const canUseNotesRef = useRef(false);
  const canEditClass = classRole === 'owner' || classRole === 'manager';
  const isOwner = classRole === 'owner';
  const canUseNotes = classRole !== null;

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      accessTokenRef.current = data.session?.access_token || null;
    };

    void loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token || null;
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadClass = async () => {
      if (!auth.user || !slug) return;

      try {
        setLoading(true);

        let { data, error } = await supabase
          .from('classes')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();

        if (!data && !error && isUuid(slug)) {
          const fallback = await supabase
            .from('classes')
            .select('*')
            .eq('id', slug)
            .single();

          data = fallback.data;
          error = fallback.error;
        }

        if (error) throw error;
        if (!data) throw new Error('Class not found');

        setClassData(data);
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Class not found');
        console.error('Error loading class:', error);
        console.error('Error details:', message);
        alert('Class not found. Redirecting to dashboard...');
        router.push('/dashboard');
      } finally {
        setLoading(false);
      }
    };

    void loadClass();
  }, [auth.user, slug, router]);

  useEffect(() => {
    const loadClassData = async () => {
      if (!classData || !auth.user) return;

      try {
        const nextRole: ClassRole = classData.user_id === auth.user.id
          ? 'owner'
          : await (async () => {
            const { data: roleData, error: roleError } = await supabase.rpc('get_class_role', {
              target_class_id: classData.id,
            });

            if (roleError) throw roleError;

            if (roleData === 'owner' || roleData === 'manager' || roleData === 'student') {
              return roleData;
            }

            throw new Error('Unauthorized to access this class');
          })();

        setClassRole(nextRole);

        const [recordingsResult, booksResult, sectionsResult] = await Promise.all([
          supabase
            .from('recordings')
            .select('*')
            .eq('class_id', classData.id)
            .order('uploaded_at', { ascending: false }),
          supabase
            .from('books')
            .select('*')
            .eq('class_id', classData.id),
          supabase
            .from('book_sections')
            .select('*')
            .eq('class_id', classData.id)
            .order('position', { ascending: true }),
        ]);

        if (recordingsResult.error) throw recordingsResult.error;
        if (booksResult.error) throw booksResult.error;
        if (sectionsResult.error) throw sectionsResult.error;

        setRecordings((recordingsResult.data || []) as Recording[]);
        setBooks((booksResult.data || []) as Book[]);
        setBookSections((sectionsResult.data || []) as BookSection[]);
      } catch (error) {
        console.error('Error loading class data:', error);
      }
    };

    void loadClassData();
  }, [classData, auth.user]);

  useEffect(() => {
    noteContentRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    currentNoteContentRef.current = currentNote?.content || '';
  }, [currentNote]);

  useEffect(() => {
    classIdRef.current = classData?.id || null;
  }, [classData]);

  useEffect(() => {
    canUseNotesRef.current = canUseNotes;
  }, [canUseNotes]);

  useEffect(() => {
    if (!memberMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;

      if (memberMenuRef.current?.contains(target)) {
        return;
      }

      if (target.closest(`[data-member-menu-trigger="${memberMenu.memberId}"]`)) {
        return;
      }

      setMemberMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMemberMenu(null);
      }
    };

    const closeMenu = () => {
      setMemberMenu(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [memberMenu]);

  useEffect(() => {
    const loadNote = async () => {
      if (!classData || !auth.user || activeTab !== 'notes') return;

      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('class_id', classData.id)
          .eq('user_id', auth.user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setCurrentNote(data as Note);
          setNoteContent(data.content || '');
          setNoteError(null);
        } else {
          setCurrentNote({
            id: '',
            class_id: classData.id,
            user_id: auth.user.id,
            content: '',
            updated_at: new Date().toISOString(),
          });
          setNoteContent('');
          setNoteError(null);
        }
      } catch (error) {
        console.error('Error loading note:', error);
      }
    };

    void loadNote();
  }, [activeTab, classData, auth.user]);

  useEffect(() => {
    const loadMembers = async () => {
      if (!classData || !canEditClass || activeTab !== 'students') return;

      try {
        setMembersLoading(true);
        setMemberError(null);

        const { data, error } = await supabase.rpc('list_class_members', {
          target_class_id: classData.id,
        });

        if (error) throw error;
        setMembers((data || []) as ClassMember[]);
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Failed to load members');
        console.error('Error loading members:', error);
        setMemberError(message);
      } finally {
        setMembersLoading(false);
      }
    };

    void loadMembers();
  }, [classData, canEditClass, activeTab]);

  const loadRecordings = async () => {
    if (!classData) return;

    const { data, error } = await supabase
      .from('recordings')
      .select('*')
      .eq('class_id', classData.id)
      .order('uploaded_at', { ascending: false });

    if (error) throw error;
    setRecordings((data || []) as Recording[]);
  };

  const loadBooks = async () => {
    if (!classData) return;

    const { data, error } = await supabase
      .from('books')
      .select('*')
      .eq('class_id', classData.id);

    if (error) throw error;
    setBooks((data || []) as Book[]);
  };

  const loadBookSections = async () => {
    if (!classData) return;

    const { data, error } = await supabase
      .from('book_sections')
      .select('*')
      .eq('class_id', classData.id)
      .order('position', { ascending: true });

    if (error) throw error;
    setBookSections((data || []) as BookSection[]);
  };

  const loadBooksAndSections = async () => {
    await Promise.all([loadBooks(), loadBookSections()]);
  };

  const loadMembers = async () => {
    if (!classData || !canEditClass) return;

    const { data, error } = await supabase.rpc('list_class_members', {
      target_class_id: classData.id,
    });

    if (error) throw error;
    setMembers((data || []) as ClassMember[]);
  };

  const handleAddMember = async () => {
    if (!classData || !canEditClass || !memberEmail.trim()) return;

    try {
      setAddingMember(true);
      setMemberError(null);

      const { error } = await supabase.rpc('add_user_to_class_by_email', {
        target_class_id: classData.id,
        target_email: memberEmail.trim(),
        target_role: 'student',
      });

      if (error) throw error;

      setMemberEmail('');
      await loadMembers();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to add user');
      console.error('Error adding member:', error);
      setMemberError(message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (member: ClassMember) => {
    if (!classData || !canEditClass) return;

    setMemberMenu(null);
    const confirmed = window.confirm(`Remove ${member.email} from this class?`);
    if (!confirmed) return;

    try {
      setUpdatingMemberId(member.user_id);
      setMemberError(null);

      const { data, error } = await supabase.rpc('remove_user_from_class', {
        target_class_id: classData.id,
        target_user_id: member.user_id,
      });

      if (error) throw error;
      if (!data) {
        throw new Error('User is not enrolled in this class');
      }

      await loadMembers();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to remove user');
      console.error('Error removing member:', error);
      setMemberError(message);
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleChangeMemberRole = async (member: ClassMember, nextRole: Exclude<ClassRole, 'owner'>) => {
    if (!classData || !isOwner) return;

    try {
      setMemberMenu(null);
      setUpdatingMemberId(member.user_id);
      setMemberError(null);

      const { error } = await supabase.rpc('update_class_member_role', {
        target_class_id: classData.id,
        target_user_id: member.user_id,
        target_role: nextRole,
      });

      if (error) throw error;

      await loadMembers();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to update role');
      console.error('Error updating member role:', error);
      setMemberError(message);
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleTransferOwnership = async () => {
    if (!classData || !isOwner || !transferOwnershipTarget) return;

    if (transferOwnershipEmail.trim().toLowerCase() !== transferOwnershipTarget.email.trim().toLowerCase()) {
      setTransferOwnershipError('Email confirmation does not match the selected member.');
      return;
    }

    if (!classData || !isOwner) return;

    try {
      setUpdatingMemberId(transferOwnershipTarget.user_id);
      setMemberError(null);
      setTransferOwnershipError(null);

      const { error } = await supabase.rpc('transfer_class_ownership', {
        target_class_id: classData.id,
        target_user_id: transferOwnershipTarget.user_id,
      });

      if (error) throw error;

      setClassData((currentClass) => (
        currentClass ? { ...currentClass, user_id: transferOwnershipTarget.user_id } : currentClass
      ));
      setClassRole('manager');
      setTransferOwnershipTarget(null);
      setTransferOwnershipEmail('');
      await loadMembers();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to transfer ownership');
      console.error('Error transferring ownership:', error);
      setMemberError(message);
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const openTransferOwnershipDialog = (member: ClassMember) => {
    setMemberMenu(null);
    setTransferOwnershipTarget(member);
    setTransferOwnershipEmail('');
    setTransferOwnershipError(null);
  };

  const closeTransferOwnershipDialog = () => {
    if (updatingMemberId && transferOwnershipTarget?.user_id === updatingMemberId) return;
    setTransferOwnershipTarget(null);
    setTransferOwnershipEmail('');
    setTransferOwnershipError(null);
  };

  const handleCreateSection = async () => {
    if (!classData || !canEditClass || !newSectionTitle.trim()) return;

    try {
      setCreatingSection(true);

      const { error } = await supabase
        .from('book_sections')
        .insert({
          class_id: classData.id,
          title: newSectionTitle.trim(),
          position: bookSections.length,
        });

      if (error) throw error;

      setNewSectionTitle('');
      await loadBookSections();
    } catch (error) {
      console.error('Error creating book section:', error);
      alert(getErrorMessage(error, 'Failed to create section'));
    } finally {
      setCreatingSection(false);
    }
  };

  const persistSectionOrder = async (orderedSections: BookSection[]) => {
    setBookSections(orderedSections.map((section, index) => ({
      ...section,
      position: index,
    })));

    await Promise.all(
      orderedSections.map(async (section, index) => {
        if (section.position === index) return;

        const { error } = await supabase
          .from('book_sections')
          .update({ position: index })
          .eq('id', section.id);

        if (error) throw error;
      })
    );

    await loadBookSections();
  };

  const handleDropSection = async (targetSectionId: string, placement: 'before' | 'after') => {
    if (!draggedSectionId || draggedSectionId === targetSectionId) return;

    const orderedSections = [...bookSections].sort(compareSections);
    const sourceIndex = orderedSections.findIndex((section) => section.id === draggedSectionId);
    const targetIndexBase = orderedSections.findIndex((section) => section.id === targetSectionId);
    if (sourceIndex < 0 || targetIndexBase < 0) {
      setDraggedSectionId(null);
      setSectionDropTarget(null);
      return;
    }

    const nextSections = [...orderedSections];
    const [draggedSection] = nextSections.splice(sourceIndex, 1);

    let insertIndex = targetIndexBase;
    if (sourceIndex < targetIndexBase) {
      insertIndex -= 1;
    }
    if (placement === 'after') {
      insertIndex += 1;
    }

    nextSections.splice(Math.max(0, insertIndex), 0, draggedSection);

    try {
      await persistSectionOrder(nextSections);
    } catch (error) {
      console.error('Error reordering section:', error);
      await loadBookSections();
      alert(getErrorMessage(error, 'Failed to reorder section'));
    } finally {
      setDraggedSectionId(null);
      setSectionDropTarget(null);
    }
  };

  const handleRenameSection = async () => {
    if (!editingSectionId || !sectionTitleDraft.trim()) return;

    try {
      const { error } = await supabase
        .from('book_sections')
        .update({ title: sectionTitleDraft.trim() })
        .eq('id', editingSectionId);

      if (error) throw error;

      setEditingSectionId(null);
      setSectionTitleDraft('');
      setBookSections((currentSections) =>
        currentSections.map((section) =>
          section.id === editingSectionId ? { ...section, title: sectionTitleDraft.trim() } : section
        )
      );
    } catch (error) {
      console.error('Error renaming section:', error);
      alert(getErrorMessage(error, 'Failed to rename section'));
    }
  };

  const handleRenameBook = async () => {
    if (!editingBookId || !bookTitleDraft.trim()) return;

    try {
      const { error } = await supabase
        .from('books')
        .update({ title: bookTitleDraft.trim() })
        .eq('id', editingBookId);

      if (error) throw error;

      setEditingBookId(null);
      setBookTitleDraft('');
      await loadBooks();
    } catch (error) {
      console.error('Error renaming book:', error);
      alert(getErrorMessage(error, 'Failed to rename book'));
    }
  };

  const handleRenameRecording = async () => {
    if (!editingRecordingId || !recordingTitleDraft.trim()) return;

    try {
      const { error } = await supabase
        .from('recordings')
        .update({ title: recordingTitleDraft.trim() })
        .eq('id', editingRecordingId);

      if (error) throw error;

      setEditingRecordingId(null);
      setRecordingTitleDraft('');
      setRecordings((currentRecordings) =>
        currentRecordings.map((recording) =>
          recording.id === editingRecordingId ? { ...recording, title: recordingTitleDraft.trim() } : recording
        )
      );
    } catch (error) {
      console.error('Error renaming recording:', error);
      alert(getErrorMessage(error, 'Failed to rename recording'));
    }
  };

  const persistBookSection = async (sectionId: string | null, orderedBooks: Book[]) => {
    await Promise.all(
      orderedBooks.map(async (book, index) => {
        const existingBook = books.find((item) => item.id === book.id);
        if (existingBook && existingBook.position === index && existingBook.section_id === sectionId) return;

        const { error } = await supabase
          .from('books')
          .update({
            section_id: sectionId,
            position: index,
          })
          .eq('id', book.id);

        if (error) throw error;
      })
    );

    await loadBooks();
  };

  const handleDeleteBook = async (book: Book) => {
    if (!canEditClass) return;

    const confirmed = window.confirm(`Delete "${book.title}"? This will remove the book file too.`);
    if (!confirmed) return;

    try {
      setDeletingBookId(book.id);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const response = await fetch(`/api/books/${book.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to delete book');
      }

      const remainingBooks = books
        .filter((item) => item.id !== book.id && item.section_id === book.section_id)
        .sort(compareBooks);

      await persistBookSection(book.section_id, remainingBooks);
    } catch (error) {
      console.error('Error deleting book:', error);
      alert(getErrorMessage(error, 'Failed to delete book'));
    } finally {
      setDeletingBookId(null);
    }
  };

  const handleDeleteRecording = async (recording: Recording) => {
    if (!canEditClass) return;

    const confirmed = window.confirm(`Delete "${recording.title}"? This will remove the video file too.`);
    if (!confirmed) return;

    try {
      setDeletingRecordingId(recording.id);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const response = await fetch(`/api/recordings/${recording.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to delete recording');
      }

      await loadRecordings();
    } catch (error) {
      console.error('Error deleting recording:', error);
      alert(getErrorMessage(error, 'Failed to delete recording'));
    } finally {
      setDeletingRecordingId(null);
    }
  };

  const handleDropBook = async (
    targetSectionId: string | null,
    targetBookId?: string,
    placement: 'before' | 'after' | 'inside' = 'inside'
  ) => {
    const activeDraggedBook = draggedBookRef.current ?? draggedBook;
    if (!activeDraggedBook) return;

    const draggedItem = books.find((book) => book.id === activeDraggedBook.bookId);
    if (!draggedItem) {
      setDraggedBook(null);
      draggedBookRef.current = null;
      setBookDropTarget(null);
      return;
    }

    const sourceSectionId = activeDraggedBook.fromSectionId;
    const sourceBooks = books
      .filter((book) => book.section_id === sourceSectionId && book.id !== draggedItem.id)
      .sort(compareBooks);

    const targetBaseBooks = (sourceSectionId === targetSectionId ? sourceBooks : books
      .filter((book) => book.section_id === targetSectionId && book.id !== draggedItem.id)
      .sort(compareBooks));

    let insertIndex = targetBookId
      ? targetBaseBooks.findIndex((book) => book.id === targetBookId)
      : targetBaseBooks.length;

    if (insertIndex < 0) {
      insertIndex = targetBaseBooks.length;
    } else if (placement === 'after') {
      insertIndex += 1;
    }

    const nextTargetBooks = [...targetBaseBooks];
    nextTargetBooks.splice(insertIndex, 0, {
      ...draggedItem,
      section_id: targetSectionId,
    });

    const nextBooks = books.map((book) => {
      if (book.id === draggedItem.id) {
        return {
          ...book,
          section_id: targetSectionId,
          position: insertIndex,
        };
      }

      return book;
    });

    sourceBooks.forEach((book, index) => {
      const bookIndex = nextBooks.findIndex((item) => item.id === book.id);
      if (bookIndex >= 0) {
        nextBooks[bookIndex] = {
          ...nextBooks[bookIndex],
          section_id: sourceSectionId,
          position: index,
        };
      }
    });

    nextTargetBooks.forEach((book, index) => {
      const bookIndex = nextBooks.findIndex((item) => item.id === book.id);
      if (bookIndex >= 0) {
        nextBooks[bookIndex] = {
          ...nextBooks[bookIndex],
          section_id: targetSectionId,
          position: index,
        };
      }
    });

    try {
      setBooks(nextBooks);
      if (sourceSectionId === targetSectionId) {
        await persistBookSection(targetSectionId, nextTargetBooks);
      } else {
        await Promise.all([
          persistBookSection(sourceSectionId, sourceBooks),
          persistBookSection(targetSectionId, nextTargetBooks),
        ]);
      }
    } catch (error) {
      console.error('Error dropping book:', error);
      alert(getErrorMessage(error, 'Failed to move book'));
      await loadBooks();
    } finally {
      setDraggedBook(null);
      draggedBookRef.current = null;
      setBookDropTarget(null);
    }
  };

  const handleVideoUploadSuccess = () => {
    setVideoUploadModalOpen(false);
    void loadRecordings();
  };

  const handleBookUploadSuccess = () => {
    setBookUploadTarget(null);
    void loadBooksAndSections();
  };

  const persistNote = async (content: string, options?: { background?: boolean }) => {
    if (!classData || !auth.user) return true;

    const payload = {
      classId: classData.id,
      content,
    };

    if (options?.background) {
      const token = accessTokenRef.current;
      if (!token) return false;

      fetch('/api/notes/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch((error) => {
        console.error('Background note save error:', error);
      });

      return true;
    }

    setSavingNote(true);
    setNoteError(null);

    try {
      const { data, error } = await supabase
        .from('notes')
        .upsert(
          {
            class_id: classData.id,
            user_id: auth.user.id,
            content,
          },
          {
            onConflict: 'class_id,user_id',
          }
        )
        .select()
        .single();

      if (error || !data) throw error || new Error('Failed to save note');

      setCurrentNote(data as Note);
      return true;
    } catch (error) {
      console.error('Error saving note:', error);
      setNoteError(getErrorMessage(error, 'Failed to save note'));
      return false;
    } finally {
      setSavingNote(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      router.push('/signin');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const savedNoteContent = currentNote?.content || '';
  const hasUnsavedNoteChanges = canUseNotes && activeTab === 'notes' && noteContent !== savedNoteContent;

  const handleTabChange = async (nextTab: TabType) => {
    if (nextTab === activeTab) return;

    if (activeTab === 'notes' && hasUnsavedNoteChanges) {
      const saved = await persistNote(noteContent);
      if (!saved) return;
    }

    setActiveTab(nextTab);
  };

  useEffect(() => {
    const handlePageHide = (event?: PageTransitionEvent | Event) => {
      if (event?.type === 'visibilitychange' && document.visibilityState !== 'hidden') {
        return;
      }

      const currentClassId = classIdRef.current;
      if (!currentClassId || !canUseNotesRef.current) return;

      const latestContent = noteContentRef.current;
      const savedContent = currentNoteContentRef.current;
      if (latestContent === savedContent) return;

      const token = accessTokenRef.current;
      if (!token) return;

      fetch('/api/notes/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId: currentClassId,
          content: latestContent,
        }),
        keepalive: true,
      }).catch((error) => {
        console.error('Background note save error:', error);
      });
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handlePageHide);
    };
  }, []);

  const handleSaveNote = async () => {
    await persistNote(noteContent);
  };

  if (auth.loading || loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.user || !classData) {
    return null;
  }

  const currentUserId = auth.user.id;
  const orderedSections = [...bookSections].sort(compareSections);
  const organizedSections: OrganizedBookSection[] = orderedSections.map((section) => ({
    ...section,
    books: books.filter((book) => book.section_id === section.id).sort(compareBooks),
  }));
  const unassignedBooks = books.filter((book) => book.section_id === null).sort(compareBooks);
  const activeMemberMenuMember = memberMenu
    ? members.find((member) => member.user_id === memberMenu.memberId) ?? null
    : null;
  const renderSectionDropIndicator = () => (
    <div className="my-3 h-2 rounded-full bg-blue-500/90 shadow-sm" aria-hidden="true" />
  );
  const renderDropIndicator = (compact = false) => (
    <div
      className={`rounded-full bg-blue-500/90 shadow-sm transition-all ${compact ? 'my-1 h-1.5' : 'my-2 h-2'}`}
      aria-hidden="true"
    />
  );

  const renderBookCards = (sectionId: string | null, sectionBooks: Book[]) => {
    const isEmptyDropTarget = bookDropTarget?.sectionId === sectionId && bookDropTarget.targetBookId === null;

    if (sectionBooks.length === 0) {
      return (
        <div
          onDragEnter={(event) => {
            if (!canEditClass || !draggedBookRef.current) return;
            event.preventDefault();
            setBookDropTarget({ sectionId, targetBookId: null, placement: 'inside' });
          }}
          onDragOver={(event) => {
            if (!canEditClass || !draggedBookRef.current) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setBookDropTarget({ sectionId, targetBookId: null, placement: 'inside' });
          }}
          onDrop={(event) => {
            if (!canEditClass) return;
            event.preventDefault();
            event.stopPropagation();
            void handleDropBook(sectionId, undefined, 'inside');
          }}
          className={`flex min-h-32 items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-sm transition ${isEmptyDropTarget ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-gray-50 text-gray-500'}`}
        >
          <div className="text-center">
            <p className="font-medium">No books in this section.</p>
            <p className="mt-1 text-xs opacity-80">Drag a book here to move it in.</p>
          </div>
        </div>
      );
    }

    return (
      <div
        onDragEnter={(event) => {
          if (!canEditClass || !draggedBookRef.current) return;
          event.preventDefault();
          setBookDropTarget({ sectionId, targetBookId: null, placement: 'inside' });
        }}
        onDragOver={(event) => {
          if (!canEditClass || !draggedBookRef.current) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (event.target === event.currentTarget) {
            setBookDropTarget({ sectionId, targetBookId: null, placement: 'inside' });
          }
        }}
        onDrop={(event) => {
          if (!canEditClass) return;
          event.preventDefault();
          event.stopPropagation();
          void handleDropBook(sectionId, undefined, 'inside');
        }}
        className={`space-y-3 rounded-xl transition ${isEmptyDropTarget ? 'bg-blue-50/60 p-2' : ''}`}
      >
        {sectionBooks.map((book) => (
          <div key={book.id}>
            {bookDropTarget?.sectionId === sectionId &&
              bookDropTarget.targetBookId === book.id &&
              bookDropTarget.placement === 'before' &&
              renderDropIndicator()}
            <div
              draggable={canEditClass}
              onDragStart={(event) => {
                if (!canEditClass) return;
                const nextDraggedBook = { bookId: book.id, fromSectionId: sectionId };
                draggedBookRef.current = nextDraggedBook;
                setDraggedBook(nextDraggedBook);
                setBookDropTarget({ sectionId, targetBookId: book.id, placement: 'before' });
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                draggedBookRef.current = null;
                setDraggedBook(null);
                setBookDropTarget(null);
              }}
              onDragOver={(event) => {
                if (!canEditClass || !draggedBookRef.current || draggedBookRef.current.bookId === book.id) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                const rect = event.currentTarget.getBoundingClientRect();
                const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                setBookDropTarget({ sectionId, targetBookId: book.id, placement });
              }}
              onDrop={(event) => {
                if (!canEditClass || !draggedBookRef.current || draggedBookRef.current.bookId === book.id) return;
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                void handleDropBook(sectionId, book.id, placement);
              }}
              className={`rounded-xl border bg-white p-4 shadow-sm transition-all ${draggedBook?.bookId === book.id ? 'scale-[0.99] opacity-60' : 'opacity-100'} ${bookDropTarget?.sectionId === sectionId && bookDropTarget.targetBookId === book.id ? 'border-blue-300 shadow-md' : 'border-gray-200'} ${canEditClass ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                    {canEditClass && (
                      <div className="pt-0.5 text-gray-400">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01" />
                        </svg>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                    {editingBookId === book.id ? (
                      <input
                        value={bookTitleDraft}
                        onChange={(e) => setBookTitleDraft(e.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleRenameBook();
                          }
                          if (event.key === 'Escape') {
                            setEditingBookId(null);
                            setBookTitleDraft('');
                          }
                        }}
                        onBlur={() => {
                          if (!bookTitleDraft.trim()) {
                            setEditingBookId(null);
                            setBookTitleDraft('');
                            return;
                          }
                          void handleRenameBook();
                        }}
                        autoFocus
                        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!canEditClass) return;
                          setEditingBookId(book.id);
                          setBookTitleDraft(book.title);
                        }}
                        className={`group inline-flex items-center gap-2 truncate text-left text-base font-semibold text-gray-900 ${canEditClass ? 'hover:text-gray-900' : ''}`}
                      >
                        <span className="truncate">{book.title}</span>
                        {canEditClass && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 opacity-0 transition-opacity group-hover:opacity-100">
                            Click to edit
                          </span>
                        )}
                      </button>
                    )}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                        <ProcessingStatusBadge
                          bookId={book.id}
                          initialStatus={book.processing_status}
                          onStatusChange={(status) => {
                            setBooks((currentBooks) =>
                              currentBooks.map((currentBook) =>
                                currentBook.id === book.id ? { ...currentBook, processing_status: status } : currentBook
                              )
                            );
                          }}
                        />
                        <span>{formatFileSize(book.file_size)}</span>
                        <span>Uploaded {formatDate(book.uploaded_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link
                    href={`/dashboard/class/${slug}/book/${book.id}`}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Open
                  </Link>
                {canEditClass && (
                  <>
                    <button
                      onClick={() => void handleDeleteBook(book)}
                      disabled={deletingBookId === book.id}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {deletingBookId === book.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            {bookDropTarget?.sectionId === sectionId &&
              bookDropTarget.targetBookId === book.id &&
              bookDropTarget.placement === 'after' &&
              renderDropIndicator()}
          </div>
        ))}
        {bookDropTarget?.sectionId === sectionId &&
          bookDropTarget.targetBookId === null &&
          renderDropIndicator(true)}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{classData.name}</h1>
                <p className="text-sm text-gray-600">{auth.user.user_metadata?.name || auth.user.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          <div className="border-b px-6 py-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{classData.name}</h2>
                {classData.description && (
                  <p className="text-gray-600">{classData.description}</p>
                )}
                <p className="text-sm text-gray-500 mt-2">
                  Created {formatDate(classData.created_at)}
                </p>
              </div>
            </div>
          </div>

          <div className="border-b">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => void handleTabChange('recordings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'recordings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Class Recordings
                </div>
              </button>
              <button
                onClick={() => void handleTabChange('books')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'books'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Books
                </div>
              </button>
              <button
                onClick={() => void handleTabChange('notes')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'notes'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Notes
                </div>
              </button>
              {canEditClass && (
                <button
                  onClick={() => void handleTabChange('students')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'students'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-2a3 3 0 00-3-3H10a3 3 0 00-3 3v2m10 0H7m10-9a3 3 0 11-6 0 3 3 0 016 0zm-8 3a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Manage Access
                  </div>
                </button>
              )}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'recordings' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Class Recordings</h3>
                  {canEditClass && (
                    <button
                      onClick={() => setVideoUploadModalOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Upload Video
                    </button>
                  )}
                </div>
                {recordings.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500">No recordings yet.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Duration</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {recordings.map((recording) => (
                            <tr key={recording.id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                {editingRecordingId === recording.id ? (
                                  <input
                                    value={recordingTitleDraft}
                                    onChange={(event) => setRecordingTitleDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        void handleRenameRecording();
                                      }
                                      if (event.key === 'Escape') {
                                        setEditingRecordingId(null);
                                        setRecordingTitleDraft('');
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!recordingTitleDraft.trim()) {
                                        setEditingRecordingId(null);
                                        setRecordingTitleDraft('');
                                        return;
                                      }
                                      void handleRenameRecording();
                                    }}
                                    autoFocus
                                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!canEditClass) return;
                                      setEditingRecordingId(recording.id);
                                      setRecordingTitleDraft(recording.title);
                                    }}
                                    className={`group inline-flex items-center gap-2 truncate text-left text-sm font-semibold text-gray-900 ${canEditClass ? 'hover:text-gray-900' : ''}`}
                                  >
                                    <span className="truncate">{recording.title}</span>
                                    {canEditClass && (
                                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 opacity-0 transition-opacity group-hover:opacity-100">
                                        Click to edit
                                      </span>
                                    )}
                                  </button>
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${recordingStatusStyles[recording.processing_status].className}`}>
                                  {recordingStatusStyles[recording.processing_status].icon}
                                  {recordingStatusStyles[recording.processing_status].label}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">{formatDuration(recording.duration)}</td>
                              <td className="px-4 py-4 text-sm text-gray-600">{formatDate(recording.uploaded_at)}</td>
                              <td className="px-4 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Link
                                    href={`/dashboard/class/${slug}/video/${recording.id}`}
                                    className="inline-flex rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                                  >
                                    Open
                                  </Link>
                                  {canEditClass && (
                                    <button
                                      onClick={() => void handleDeleteRecording(recording)}
                                      disabled={deletingRecordingId === recording.id}
                                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {deletingRecordingId === recording.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'books' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Books</h3>
                    <p className="text-sm text-gray-500">Drag books between sections to move them, and drag within a section to reorder them.</p>
                  </div>
                  {canEditClass && (
                    <button
                      onClick={() => setBookUploadTarget({
                        sectionId: null,
                        startingPosition: unassignedBooks.length,
                      })}
                      className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Upload Books
                    </button>
                  )}
                </div>

                {canEditClass && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end">
                      <div className="flex-1">
                        <label htmlFor="section-title" className="block text-sm font-medium text-gray-700 mb-1">
                          Create Book Section
                        </label>
                        <input
                          id="section-title"
                          type="text"
                          value={newSectionTitle}
                          onChange={(e) => setNewSectionTitle(e.target.value)}
                          placeholder="e.g., Unit 1 Reading"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        onClick={handleCreateSection}
                        disabled={creatingSection || !newSectionTitle.trim()}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {creatingSection ? 'Creating...' : 'Add Section'}
                      </button>
                    </div>
                  </div>
                )}

                {organizedSections.length === 0 && unassignedBooks.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No books yet.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {organizedSections.map((section) => (
                      <div key={section.id}>
                        {sectionDropTarget?.sectionId === section.id && sectionDropTarget.placement === 'before' && renderSectionDropIndicator()}
                      <section
                        draggable={canEditClass}
                        onDragStart={(event) => {
                          if (!canEditClass) return;
                          setDraggedSectionId(section.id);
                          setSectionDropTarget({ sectionId: section.id, placement: 'before' });
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggedSectionId(null);
                          setSectionDropTarget(null);
                        }}
                        onDragOver={(event) => {
                          if (!canEditClass || !draggedSectionId || draggedSectionId === section.id) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          const rect = event.currentTarget.getBoundingClientRect();
                          const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                          setSectionDropTarget({ sectionId: section.id, placement });
                        }}
                        onDrop={(event) => {
                          if (!canEditClass || !draggedSectionId || draggedSectionId === section.id) return;
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                          void handleDropSection(section.id, placement);
                        }}
                        className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${draggedSectionId === section.id ? 'opacity-60' : 'opacity-100'} ${sectionDropTarget?.sectionId === section.id ? 'border-blue-300 shadow-md' : 'border-gray-200'} ${canEditClass ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <div className="border-b bg-gray-50 px-5 py-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                {canEditClass && (
                                  <div className="text-gray-400">
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01" />
                                    </svg>
                                  </div>
                                )}
                                {editingSectionId === section.id ? (
                                  <input
                                    value={sectionTitleDraft}
                                    onChange={(e) => setSectionTitleDraft(e.target.value)}
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        void handleRenameSection();
                                      }
                                      if (event.key === 'Escape') {
                                        setEditingSectionId(null);
                                        setSectionTitleDraft('');
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!sectionTitleDraft.trim()) {
                                        setEditingSectionId(null);
                                        setSectionTitleDraft('');
                                        return;
                                      }
                                      void handleRenameSection();
                                    }}
                                    autoFocus
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!canEditClass) return;
                                      setEditingSectionId(section.id);
                                      setSectionTitleDraft(section.title);
                                    }}
                                    className={`group inline-flex items-center gap-2 truncate text-left text-lg font-semibold text-gray-900 ${canEditClass ? 'hover:text-gray-900' : ''}`}
                                  >
                                    <span className="truncate">{section.title}</span>
                                    {canEditClass && (
                                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 opacity-0 transition-opacity group-hover:opacity-100">
                                        Click to edit
                                      </span>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            {canEditClass && (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => setBookUploadTarget({
                                    sectionId: section.id,
                                    startingPosition: section.books.length,
                                  })}
                                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                                >
                                  Add Books
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="px-5 py-5">
                          {renderBookCards(section.id, section.books)}
                        </div>
                      </section>
                        {sectionDropTarget?.sectionId === section.id && sectionDropTarget.placement === 'after' && renderSectionDropIndicator()}
                      </div>
                    ))}

                    {unassignedBooks.length > 0 && (
                      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <div className="border-b bg-gray-50 px-5 py-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <span className="inline-flex rounded-full bg-gray-600 px-2.5 py-1 text-xs font-semibold text-white">
                                  Unassigned
                                </span>
                                <h4 className="text-lg font-semibold text-gray-900">Unassigned Books</h4>
                              </div>
                              <p className="mt-2 text-sm text-gray-600">
                                {unassignedBooks.length} book{unassignedBooks.length === 1 ? '' : 's'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="px-5 py-5">
                          {renderBookCards(null, unassignedBooks)}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">My Notes</h3>
                    <p className="text-sm text-gray-500">Markdown supported.</p>
                  </div>
                  {canUseNotes && (
                    <button
                      onClick={() => void handleSaveNote()}
                      disabled={savingNote}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingNote ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
                {noteError && (
                  <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {noteError}
                  </div>
                )}
                <div className="border rounded-lg overflow-hidden">
                  <textarea
                    value={noteContent}
                    onChange={(e) => canUseNotes && setNoteContent(e.target.value)}
                    readOnly={!canUseNotes}
                    placeholder={canUseNotes ? 'Write your markdown notes here...' : 'Notes are unavailable for your access level'}
                    className="w-full h-96 resize-none px-4 py-3 font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:bg-gray-50"
                  />
                </div>
                {currentNote && currentNote.updated_at && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last updated: {new Date(currentNote.updated_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {activeTab === 'students' && canEditClass && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:flex-row md:items-end">
                  <div className="flex-1">
                    <label htmlFor="member-email" className="block text-sm font-medium text-gray-700 mb-1">
                      Add Student By Email
                    </label>
                    <input
                      id="member-email"
                      type="email"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      placeholder="student@example.com"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleAddMember}
                    disabled={addingMember || !memberEmail.trim()}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {addingMember ? 'Adding...' : 'Add Student'}
                  </button>
                </div>
                <p className="text-sm text-gray-500">
                  Managers can add or remove students. Owners can also promote managers, demote them, and transfer ownership.
                </p>

                {memberError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {memberError}
                  </div>
                )}

                {membersLoading ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">Loading members...</p>
                  </div>
                ) : members.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No members have been added to this class yet.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Name</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Email</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Role</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Added</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {members.map((member) => {
                            const isCurrentUser = member.user_id === currentUserId;
                            const canRemoveMember = member.role === 'student' || (isOwner && member.role === 'manager');
                            const canPromoteMember = isOwner && member.role === 'student';
                            const canDemoteMember = isOwner && member.role === 'manager';
                            const canTransferToMember = isOwner && member.role !== 'owner';
                            const isBusy = updatingMemberId === member.user_id;
                            const hasActions = canPromoteMember || canDemoteMember || canTransferToMember || canRemoveMember;

                            return (
                              <tr key={member.user_id} className="hover:bg-gray-50">
                                <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                  {member.name}
                                  {isCurrentUser && <span className="ml-2 text-xs text-gray-500">(You)</span>}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-600">{member.email}</td>
                                <td className="px-4 py-4 text-sm text-gray-600">
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${memberRoleStyles[member.role].className}`}>
                                    {memberRoleStyles[member.role].label}
                                  </span>
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-600">{formatDate(member.created_at)}</td>
                                <td className="px-4 py-4 text-right">
                                  {hasActions ? (
                                    <div className="inline-flex justify-end">
                                      <button
                                        onClick={(event) => {
                                          const rect = event.currentTarget.getBoundingClientRect();
                                          const menuWidth = 192;
                                          const menuLeft = Math.min(window.innerWidth - menuWidth - 16, Math.max(16, rect.right - menuWidth));
                                          const menuTop = Math.min(window.innerHeight - 16, rect.bottom + 8);

                                          setMemberMenu((current) => (
                                            current?.memberId === member.user_id
                                              ? null
                                              : { memberId: member.user_id, top: menuTop, left: menuLeft }
                                          ));
                                        }}
                                        data-member-menu-trigger={member.user_id}
                                        disabled={isBusy}
                                        className="rounded-md border border-gray-300 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label={`Open actions for ${member.email}`}
                                      >
                                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                                        </svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400">No actions</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {classData && bookUploadTarget && (
        <PdfUploadModal
          classId={classData.id}
          sectionId={bookUploadTarget.sectionId}
          startingPosition={bookUploadTarget.startingPosition}
          isOpen={true}
          onClose={() => setBookUploadTarget(null)}
          onSuccess={handleBookUploadSuccess}
        />
      )}

      {memberMenu && activeMemberMenuMember && (
        <div
          ref={memberMenuRef}
          className="fixed z-50 min-w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
          style={{ top: memberMenu.top, left: memberMenu.left }}
        >
          {isOwner && activeMemberMenuMember.role === 'student' && (
            <button
              onClick={() => void handleChangeMemberRole(activeMemberMenuMember, 'manager')}
              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              Make Manager
            </button>
          )}
          {isOwner && activeMemberMenuMember.role === 'manager' && (
            <button
              onClick={() => void handleChangeMemberRole(activeMemberMenuMember, 'student')}
              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              Make Student
            </button>
          )}
          {isOwner && activeMemberMenuMember.role !== 'owner' && (
            <button
              onClick={() => openTransferOwnershipDialog(activeMemberMenuMember)}
              className="block w-full px-4 py-2 text-left text-sm text-amber-700 hover:bg-amber-50"
            >
              Transfer Ownership
            </button>
          )}
          {(activeMemberMenuMember.role === 'student' || (isOwner && activeMemberMenuMember.role === 'manager')) && (
            <button
              onClick={() => void handleRemoveMember(activeMemberMenuMember)}
              className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {transferOwnershipTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Transfer Ownership</h4>
                <p className="mt-2 text-sm text-gray-600">
                  Type <span className="font-medium text-gray-900">{transferOwnershipTarget.email}</span> to confirm transferring ownership.
                  You will become a manager after this change.
                </p>
              </div>
              <button
                onClick={closeTransferOwnershipDialog}
                disabled={updatingMemberId === transferOwnershipTarget.user_id}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close transfer ownership dialog"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-5">
              <label htmlFor="transfer-ownership-email" className="block text-sm font-medium text-gray-700">
                Confirm with email
              </label>
              <input
                id="transfer-ownership-email"
                type="email"
                value={transferOwnershipEmail}
                onChange={(event) => {
                  setTransferOwnershipEmail(event.target.value);
                  if (transferOwnershipError) {
                    setTransferOwnershipError(null);
                  }
                }}
                placeholder={transferOwnershipTarget.email}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {transferOwnershipError && (
                <p className="mt-2 text-sm text-red-600">{transferOwnershipError}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeTransferOwnershipDialog}
                disabled={updatingMemberId === transferOwnershipTarget.user_id}
                className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleTransferOwnership()}
                disabled={updatingMemberId === transferOwnershipTarget.user_id}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updatingMemberId === transferOwnershipTarget.user_id ? 'Transferring...' : 'Transfer Ownership'}
              </button>
            </div>
          </div>
        </div>
      )}

      {classData && videoUploadModalOpen && (
        <VideoUploadModal
          classId={classData.id}
          isOpen={true}
          onClose={() => setVideoUploadModalOpen(false)}
          onSuccess={handleVideoUploadSuccess}
        />
      )}
    </div>
  );
}
