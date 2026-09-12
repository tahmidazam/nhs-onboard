import { CallPanel } from '@/components/call/CallPanel'

/** Placeholder shell until the board route lands. */
export default function App() {
  return (
    <div className="flex flex-col gap-6 p-8 max-w-2xl">
      <h1 className="text-lg">NHS Onboard</h1>
      <CallPanel
        patientName="Rahim Uddin"
        goals={[
          'Which vaccinations did you have as a child?',
          'Are you still taking the blood pressure tablets?',
        ]}
      />
    </div>
  )
}
