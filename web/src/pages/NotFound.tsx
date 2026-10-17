import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { useTitle } from '../lib/session';

export default function NotFound() {
  useTitle('Not found');
  return (
    <div className="page">
      <div className="card">
        <Empty icon="compass" title="This path leads nowhere" action={<Link className="btn" to="/overview">Back to overview</Link>}>
          Check the address, or head back to the overview.
        </Empty>
      </div>
    </div>
  );
}
