// Thin wrappers around the Brandify API with clear errors (never "Unexpected token <").

export async function fetchJson(url, body) {
  let res;
  try {
    res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch {
    throw new Error('Could not reach the Brandify server. Check your connection (and VPN) and try again.');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  if (!isJson) {
    if (res.status === 401 || res.status === 403 || res.redirected) throw new Error('Your sign-in expired. Reload the page and sign in again.');
    if (res.status === 429) throw new Error('Too many requests. Wait a few minutes and try again.');
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error('The server timed out or is restarting. Try again in a moment, or enter the details manually.');
    throw new Error(`The server sent an unexpected response (${res.status}). Try again, or enter the details manually.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts the website analysis as a background job and polls until it finishes.
// Never throws: on failure it returns the same shape with site = null and a reason.
export async function analyzeSite(params, { timeoutMs = 150000, intervalMs = 2000 } = {}) {
  const failed = (siteError) => ({ site: null, siteError, screenshot: null, screenshotSource: null });
  try {
    const { jobId } = await fetchJson('/api/site/start', params);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(intervalMs);
      const job = await fetchJson(`/api/site/job/${jobId}`);
      if (job.status === 'done') return job.result;
      if (job.status === 'error') return failed(job.error || 'The website analysis failed');
    }
    return failed('The website analysis took too long');
  } catch (e) {
    return failed(e.message);
  }
}
