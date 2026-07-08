import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { listGroups, renameGroup, deleteGroup } from '@/lib/groups';

// GET /api/groups — list groups with member counts.
export async function GET(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;
  return NextResponse.json(listGroups());
}

// PATCH /api/groups — rename a group across all its members. Body: { oldName, newName }
export async function PATCH(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const oldName = (body.oldName ?? '').trim();
  const newName = (body.newName ?? '').trim();
  if (!oldName || !newName) {
    return NextResponse.json({ error: 'oldName and newName are required' }, { status: 400 });
  }
  if (oldName === 'Ungrouped') {
    return NextResponse.json({ error: 'Cannot rename the Ungrouped group' }, { status: 400 });
  }
  const changed = renameGroup(oldName, newName);
  return NextResponse.json({ renamed: oldName, to: newName, keysUpdated: changed });
}

// DELETE /api/groups?name=X — delete a group (members reassigned to Ungrouped).
export async function DELETE(req: NextRequest) {
  const auth = requireApiRole(req, 'admin');
  if ('response' in auth) return auth.response;

  const name = (new URL(req.url).searchParams.get('name') ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (name === 'Ungrouped') {
    return NextResponse.json({ error: 'Cannot delete the Ungrouped group' }, { status: 400 });
  }
  const changed = deleteGroup(name);
  return NextResponse.json({ deleted: name, keysReassigned: changed });
}
