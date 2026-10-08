import { createBrowserRouter, Navigate } from 'react-router';
import { RootLayout, RouteFallback } from './RootLayout';
import Home from './routes/Home';

// Home is eager (first paint); everything else is its own chunk. Play pulls in three/R3F lazily.
export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    HydrateFallback: RouteFallback,
    children: [
      { index: true, Component: Home },
      {
        path: 'players',
        lazy: () => import('./routes/Players').then((m) => ({ Component: m.default })),
      },
      {
        path: 'games',
        lazy: () => import('./routes/Games').then((m) => ({ Component: m.default })),
      },
      {
        path: 'games/:id',
        lazy: () => import('./routes/Lobby').then((m) => ({ Component: m.default })),
      },
      { path: 'play', lazy: () => import('./routes/Play').then((m) => ({ Component: m.default })) },
      {
        path: 'packs',
        lazy: () => import('./routes/Packs').then((m) => ({ Component: m.default })),
      },
      {
        path: 'packs/:id',
        lazy: () => import('./routes/PackEditor').then((m) => ({ Component: m.default })),
      },
      {
        path: 'import',
        lazy: () => import('./routes/Import').then((m) => ({ Component: m.default })),
      },
      {
        path: 'settings',
        lazy: () => import('./routes/Settings').then((m) => ({ Component: m.default })),
      },
      {
        path: 'dev/dice',
        lazy: () => import('./routes/DevDice').then((m) => ({ Component: m.default })),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
