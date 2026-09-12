import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OnboardedTable } from './OnboardedTable'
import { PatientFinderDialog } from './PatientFinderDialog'

export function Board() {
  const [finderOpen, setFinderOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Onboarded patients</h1>
        <Button onClick={() => setFinderOpen(true)}>
          <PlusIcon />
          Find a patient
        </Button>
      </div>

      <OnboardedTable />

      <PatientFinderDialog open={finderOpen} onOpenChange={setFinderOpen} />
    </div>
  )
}
