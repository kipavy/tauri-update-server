import { Env } from '../worker-configuration';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path.startsWith('/download/')) {
            return proxyDownload(path.slice('/download/'.length), env);
        }

        const match = path.match(/^\/v1\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (!match) return new Response('Not found', { status: 404 });
        const [, target, arch, currentVersion] = match;

        const release = await fetchLatestRelease(env);
        if (!release) return new Response(null, { status: 204 });

        const latestJson = await fetchLatestJson(release, env);
        if (!latestJson) return new Response(null, { status: 204 });

        if (!isNewer(latestJson.version, currentVersion)) {
            return new Response(null, { status: 204 });
        }

        const platformKey = `${target}-${arch}`;
        const platform = latestJson.platforms?.[platformKey];
        if (!platform) return new Response(null, { status: 204 });

        const filename = platform.url.split('/').pop();
        platform.url = `${url.protocol}//${url.host}/download/${filename}`;

        return new Response(JSON.stringify(latestJson), {
            headers: { 'Content-Type': 'application/json' },
        });
    },
};

async function fetchLatestRelease(env: Env): Promise<any | null> {
    const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_ACCOUNT}/${env.GITHUB_REPO}/releases/latest`,
        { headers: githubHeaders(env) }
    );
    return res.ok ? res.json() : null;
}

async function fetchLatestJson(release: any, env: Env): Promise<any | null> {
    const asset = release.assets.find((a: any) => a.name === 'latest.json');
    if (!asset) return null;
    const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_ACCOUNT}/${env.GITHUB_REPO}/releases/assets/${asset.id}`,
        { headers: { ...githubHeaders(env), Accept: 'application/octet-stream' }, redirect: 'follow' }
    );
    return res.ok ? res.json() : null;
}

async function proxyDownload(filename: string, env: Env): Promise<Response> {
    const release = await fetchLatestRelease(env);
    if (!release) return new Response('Release not found', { status: 404 });

    const asset = release.assets.find((a: any) => a.name === filename);
    if (!asset) return new Response('Asset not found', { status: 404 });

    const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_ACCOUNT}/${env.GITHUB_REPO}/releases/assets/${asset.id}`,
        { headers: { ...githubHeaders(env), Accept: 'application/octet-stream' }, redirect: 'follow' }
    );
    if (!res.ok) return new Response('Download failed', { status: 502 });

    return new Response(res.body, {
        headers: { 'Content-Type': 'application/octet-stream' },
    });
}

function githubHeaders(env: Env): Record<string, string> {
    return {
        Authorization: `Bearer ${env.GITHUB_API_TOKEN}`,
        'User-Agent': 'tauri-updater',
        Accept: 'application/vnd.github.v3+json',
    };
}

function isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [lMaj, lMin, lPatch] = parse(latest);
    const [cMaj, cMin, cPatch] = parse(current);
    if (lMaj !== cMaj) return lMaj > cMaj;
    if (lMin !== cMin) return lMin > cMin;
    return lPatch > cPatch;
}
