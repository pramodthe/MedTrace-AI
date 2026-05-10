import { useState } from 'react';
import { DashboardHome } from './components/DashboardHome';
import { MainDashboard } from './components/MainDashboard';
import { FloatingActions } from './components/FloatingActions';

export default function App() {
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="min-h-screen">
        {selectedPatientId ? (
          <DashboardHome
            patientId={selectedPatientId}
            onBack={() => setSelectedPatientId(null)}
          />
        ) : (
          <MainDashboard onSelectPatient={(id) => setSelectedPatientId(id)} />
        )}
      </main>
      <FloatingActions />
    </div>
  );
}
