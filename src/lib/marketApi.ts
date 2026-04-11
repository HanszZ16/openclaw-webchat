// Skill Market API client

export type SkillMeta = {
  key: string;
  name: string;
  version: string;
  description: string;
  author: string;
  emoji: string;
  tags: string[];
  homepage: string;
  requiresAuth: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SkillDetail = {
  skill: SkillMeta;
  files: string[];
  readme: string;
};

const BASE = '/api/market';

export async function listMarketSkills(): Promise<SkillMeta[]> {
  const res = await fetch(`${BASE}/skills`);
  const data = await res.json();
  return data.skills ?? [];
}

export async function getSkillDetail(key: string): Promise<SkillDetail> {
  const res = await fetch(`${BASE}/skills/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Skill not found');
  return res.json();
}

export async function uploadSkill(
  metadata: Partial<SkillMeta> & { key: string; name: string },
  files?: Record<string, string>,
): Promise<SkillMeta> {
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata, files }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.skill;
}

export async function deleteSkill(key: string): Promise<void> {
  const res = await fetch(`${BASE}/skills/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Delete failed');
  }
}

export function downloadSkillUrl(key: string): string {
  return `${BASE}/skills/${encodeURIComponent(key)}/download`;
}
