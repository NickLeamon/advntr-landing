import { inviteIdFromPath } from './lib/preview';
import { SharePreviewScreen } from './screens/SharePreview';

export function App() {
  const inviteId = inviteIdFromPath(location.pathname);
  return (
    <>
      <header><a className="wordmark" href="/">advntr<span>.</span></a></header>
      <main><div className="wrap"><SharePreviewScreen inviteId={inviteId} /></div></main>
      <footer><a href="/privacy.html">Privacy</a></footer>
    </>
  );
}
