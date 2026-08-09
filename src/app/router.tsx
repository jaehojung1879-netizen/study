import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PracticePage } from '../features/practice/PracticePage';
import { PracticeSessionPage } from '../features/practice/PracticeSessionPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { WeaknessPage } from '../features/weakness/WeaknessPage';
import { MockPage } from '../features/mock/MockPage';
import { MockRunPage } from '../features/mock/MockRunPage';
import { QuestionsPage } from '../features/questions/QuestionsPage';
import { NotesPage } from '../features/notes/NotesPage';
import { ConceptNotePage } from '../features/notes/ConceptNotePage';
import { UpdatesPage } from '../features/updates/UpdatesPage';
import { SettingsPage } from '../features/settings/SettingsPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'practice', element: <PracticePage /> },
      { path: 'practice/:sessionId', element: <PracticeSessionPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'weakness', element: <WeaknessPage /> },
      { path: 'mock', element: <MockPage /> },
      { path: 'mock/:sessionId', element: <MockRunPage /> },
      { path: 'questions', element: <QuestionsPage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'notes/:conceptId', element: <ConceptNotePage /> },
      { path: 'updates', element: <UpdatesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

/**
 * Hash routing: GitHub Pages has no SPA rewrite, so a deep link like
 * /study/practice would 404 on refresh. `#/practice` always resolves.
 */
export const router = createHashRouter(routes);
