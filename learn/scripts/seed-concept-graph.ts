/**
 * Uploads a concept graph as the new active version for a class.
 *   npm run graph:seed -- --class <class-uuid> [--file ../data/concept_graph/dl_course.json]
 * Uses SUPABASE_SERVICE_ROLE_KEY (server-only) from .env.local. Older versions are kept inactive,
 * so learner states can still be interpreted; the app reconciles states to the new version.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { ConceptGraph } from '@/lib/tutor/concept-graph';
import { readGraphSpec } from '@/lib/tutor/graph-io';

async function main() {
  const { values } = parseArgs({
    options: {
      class: { type: 'string' },
      file: { type: 'string', default: resolve(process.cwd(), '..', 'data', 'concept_graph', 'dl_course.json') },
    },
  });
  const classId = values.class;
  if (!classId) throw new Error('Pass --class <class-uuid>');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');

  const spec = readGraphSpec(resolve(values.file!));
  const graph = new ConceptGraph(spec); // validate before touching the database
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: klass, error: classError } = await supabase.from('classes').select('id').eq('id', classId).maybeSingle();
  if (classError) throw new Error(classError.message);
  if (!klass) throw new Error(`Class ${classId} not found`);

  const { data: latest, error: latestError } = await supabase
    .from('concept_graphs')
    .select('id, version, is_active')
    .eq('class_id', classId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);

  const { data: active } = await supabase.from('concept_graphs').select('id').eq('class_id', classId).eq('is_active', true).maybeSingle();
  if (active) {
    const { error } = await supabase.from('concept_graphs').update({ is_active: false }).eq('id', active.id);
    if (error) throw new Error(error.message);
  }

  const version = (latest?.version ?? 0) + 1;
  const { error: insertError } = await supabase
    .from('concept_graphs')
    .insert({ class_id: classId, version, spec, is_active: true });
  if (insertError) {
    if (active) await supabase.from('concept_graphs').update({ is_active: true }).eq('id', active.id);
    throw new Error(`Insert failed (previous graph re-activated): ${insertError.message}`);
  }

  console.log(`Seeded concept graph v${version} (${graph.conceptIds.length} concepts) for class ${classId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
