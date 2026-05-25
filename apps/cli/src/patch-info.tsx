/**
 * `ncsx patch info` — print a summary of a `.ncsxpatch.yaml` or
 * `.MAN` file. Auto-detects which format by extension first, content
 * sniff second.
 *
 * Renders via ink (React for terminals) so the multi-section layout
 * (header / metadata / per-module block) stays consistent regardless
 * of terminal width.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import React from 'react';
import { render, Box, Text } from 'ink';
import { parsePatch, type PatchFile } from '@emdzej/ncsx-patches';
import { parseFswPswTrace, type FswPswSelection } from '@emdzej/ncsx-trace';

export interface InfoOptions {
  json: boolean;
}

export function runInfo(file: string, opts: InfoOptions): void {
  const text = readFileSync(file, 'utf-8');
  const format = detectFormat(file, text);

  if (format === 'patch') {
    const patch = parsePatch(text);
    if (opts.json) {
      process.stdout.write(JSON.stringify(buildPatchSummary(patch), null, 2) + '\n');
      return;
    }
    render(<PatchInfo patch={patch} path={file} />);
  } else {
    const selections = parseFswPswTrace(text);
    if (opts.json) {
      process.stdout.write(JSON.stringify(buildManSummary(selections), null, 2) + '\n');
      return;
    }
    render(<ManInfo selections={selections} path={file} />);
  }
}

function detectFormat(path: string, text: string): 'patch' | 'man' {
  const ext = extname(path).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') return 'patch';
  if (ext === '.man') return 'man';
  // Content sniff — `.ncsxpatch.yaml` always declares the schema.
  if (/^\s*schema\s*:\s*ncsx-patch\/v1\s*$/m.test(text)) return 'patch';
  return 'man';
}

interface PatchSummary {
  title: string;
  chassis: string;
  author?: string;
  description?: string;
  keywords?: string[];
  totalEdits: number;
  modules: Array<{
    name: string;
    editCount: number;
    description?: string;
    codingIndexes?: string[];
  }>;
}

function buildPatchSummary(patch: PatchFile): PatchSummary {
  return {
    title: patch.title,
    chassis: patch.chassis,
    ...(patch.author !== undefined && { author: patch.author }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.keywords !== undefined && { keywords: patch.keywords }),
    totalEdits: patch.modules.reduce((n, m) => n + Object.keys(m.edits).length, 0),
    modules: patch.modules.map((m) => ({
      name: m.module,
      editCount: Object.keys(m.edits).length,
      ...(m.description !== undefined && { description: m.description }),
      ...(m.coding_indexes !== undefined && { codingIndexes: m.coding_indexes }),
    })),
  };
}

interface ManSummary {
  totalFsw: number;
  totalPsw: number;
  multiPswFsw: Array<{ fsw: string; pswCount: number }>;
  emptyFsw: string[];
}

function buildManSummary(selections: readonly FswPswSelection[]): ManSummary {
  return {
    totalFsw: selections.length,
    totalPsw: selections.reduce((n, s) => n + s.pswKeywords.length, 0),
    multiPswFsw: selections
      .filter((s) => s.pswKeywords.length > 1)
      .map((s) => ({ fsw: s.fswKeyword, pswCount: s.pswKeywords.length })),
    emptyFsw: selections.filter((s) => s.pswKeywords.length === 0).map((s) => s.fswKeyword),
  };
}

function PatchInfo({ patch, path }: { patch: PatchFile; path: string }): React.JSX.Element {
  const summary = buildPatchSummary(patch);
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {path}
        </Text>
        <Text dimColor> (.ncsxpatch.yaml)</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        <Field label="title" value={summary.title} />
        <Field label="chassis" value={summary.chassis} valueColor="green" />
        {summary.author && <Field label="author" value={summary.author} />}
        {summary.keywords && summary.keywords.length > 0 && (
          <Field label="keywords" value={summary.keywords.join(', ')} dim />
        )}
        {summary.description && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>description:</Text>
            <Box marginLeft={2}>
              <Text>{summary.description}</Text>
            </Box>
          </Box>
        )}
      </Box>

      <Box marginTop={1} marginBottom={1}>
        <Text color="yellow">modules</Text>
        <Text dimColor>
          {' '}({summary.modules.length} module{summary.modules.length === 1 ? '' : 's'},{' '}
          {summary.totalEdits} edit{summary.totalEdits === 1 ? '' : 's'} total)
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        {summary.modules.map((m) => (
          <Box key={m.name} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color="green" bold>
                {m.name}
              </Text>
              <Text dimColor>
                {' — '}
                {m.editCount} edit{m.editCount === 1 ? '' : 's'}
              </Text>
              {m.codingIndexes && m.codingIndexes.length > 0 && (
                <Text dimColor> [{m.codingIndexes.join(', ')}]</Text>
              )}
            </Box>
            {m.description && (
              <Box marginLeft={2}>
                <Text>{m.description}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ManInfo({
  selections,
  path,
}: {
  selections: readonly FswPswSelection[];
  path: string;
}): React.JSX.Element {
  const summary = buildManSummary(selections);
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {path}
        </Text>
        <Text dimColor> (.MAN)</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        <Field label="FSW entries" value={String(summary.totalFsw)} valueColor="green" />
        <Field label="PSW entries" value={String(summary.totalPsw)} />
        {summary.multiPswFsw.length > 0 && (
          <Field
            label="multi-PSW FSWs"
            value={`${summary.multiPswFsw.length} (lossy on patch conversion)`}
            valueColor="yellow"
          />
        )}
        {summary.emptyFsw.length > 0 && (
          <Field label="empty FSWs" value={String(summary.emptyFsw.length)} valueColor="yellow" />
        )}
      </Box>

      {selections.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">edits</Text>
          <Box flexDirection="column" marginLeft={2}>
            {selections.map((sel) => (
              <Box key={sel.fswKeyword}>
                <Text color="green">{sel.fswKeyword}</Text>
                <Text dimColor> → </Text>
                <Text>{sel.pswKeywords.length === 0 ? '(no PSW)' : sel.pswKeywords.join(', ')}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function Field({
  label,
  value,
  valueColor,
  dim,
}: {
  label: string;
  value: string;
  valueColor?: string;
  dim?: boolean;
}): React.JSX.Element {
  return (
    <Box>
      <Text dimColor>{label.padEnd(13)}</Text>
      <Text color={valueColor} dimColor={dim}>
        {value}
      </Text>
    </Box>
  );
}
