import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '#/components/ui/Button'
import { Card, CardHeader, CardTitle } from '#/components/ui/Card'
import { Textarea } from '#/components/ui/Input'
import { commitImport, previewImport } from '#/lib/csv-import.functions'

/**
 * CSV import, the migration path from the spreadsheet this app replaces.
 *
 * Two steps on purpose: preview reports exactly what would happen, then commit.
 * Importing a file straight into a shared ledger is not a thing to do
 * optimistically.
 */
export function ImportCard({ spaceId }: { spaceId: string | null }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewImport>
  > | null>(null)

  const runPreview = useMutation({
    mutationFn: () => previewImport({ data: { spaceId: spaceId!, csv: text } }),
    onSuccess: setPreview,
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Could not read that file'),
  })

  const commit = useMutation({
    mutationFn: () => commitImport({ data: { spaceId: spaceId!, csv: text } }),
    onSuccess: async (r) => {
      toast.success(
        `Imported ${r.created} row(s)` +
          (r.skippedDuplicates > 0
            ? `, skipped ${r.skippedDuplicates} duplicate(s)`
            : ''),
      )
      setText('')
      setPreview(null)
      await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] })
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Import from a spreadsheet</CardTitle>
      </CardHeader>
      <p className="text-xs text-ink-faint mb-3">
        CSV with the columns{' '}
        <code className="font-mono">
          date, purpose, amount, category, paid_by, note
        </code>
        . Categories and members are matched by name and created if missing.
        Re-running skips rows already present.
      </p>

      <div className="flex gap-2 mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Choose a CSV file"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setText(await file.text())
            setPreview(null)
          }}
          className="text-sm"
        />
      </div>

      <Textarea
        rows={4}
        aria-label="CSV contents"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPreview(null)
        }}
        placeholder="date,purpose,amount,category,paid_by,note"
        className="font-mono text-xs"
      />

      <div className="flex gap-2 mt-3">
        <Button
          disabled={
            !spaceId || text.trim().length === 0 || runPreview.isPending
          }
          onClick={() => runPreview.mutate()}
        >
          {runPreview.isPending ? 'Checking…' : 'Preview'}
        </Button>
        {preview?.ok && (
          <Button
            disabled={!preview.importable || commit.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending
              ? 'Importing…'
              : `Import ${preview.importable} row(s)`}
          </Button>
        )}
      </div>

      {preview && (
        <div className="mt-3 text-sm">
          {preview.ok ? (
            <p className="text-sage">
              {preview.importable} row(s) ready to import.
              {preview.skippedDuplicates > 0 &&
                ` ${preview.skippedDuplicates} already present and will be skipped.`}
              {preview.createdCategories.length > 0 &&
                ` New categories to create: ${preview.createdCategories
                  .map((c) => c.name)
                  .join(', ')}.`}
            </p>
          ) : (
            <>
              <p className="text-oxblood-ink">
                {preview.problems.length} problem(s), so nothing will be
                imported.
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {preview.problems.slice(0, 10).map((p, i) => (
                  <li key={i}>
                    Line {p.line}: {p.message}
                  </li>
                ))}
                {preview.problems.length > 10 && (
                  <li>…and {preview.problems.length - 10} more.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
