 
import Layout from "../components/Layout";

export default function Dashboard() {
  return (
    <Layout>

      <div className="card p-10 text-center">
        <div className="flex justify-center items-center gap-3 text-4xl font-semibold">
          <span>0</span>
          <span>⚡</span>
        </div>

        <p className="mt-2 text-gray-600">successful runs</p>
        <p className="mt-2 text-sm text-gray-400">
          [No data available yet]
        </p>
      </div>

      <div className="mt-6 card">
        <div className="flex justify-between items-center px-5 py-4 border-b">
          <h2 className="font-semibold">Deployments</h2>

          <div className="flex gap-2">
            <button className="btn-secondary">Docs</button>
            <button className="btn-secondary">API Key</button>
            <button className="btn-secondary">+</button>
          </div>
        </div>
      </div>

    </Layout>
  );
}