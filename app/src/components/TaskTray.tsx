import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { TaskProjection, TaskStatus } from '../state/taskProjection';
import { colors } from '../theme';
import { Sheet } from './Sheet';
import { Button, ui } from './UI';

const labels: Record<TaskStatus, string> = {
  running: 'Running', needs_you: 'Needs you', complete: 'Complete', failed: 'Failed', interrupted: 'Interrupted',
  unknown: 'Unknown', cancel_requested: 'Cancel requested',
};

/** All callbacks are scoped by the caller to the current origin and parent session. */
export function TaskTray({ visible, scope, tasks, refreshing, error, result, onClose, onRefresh, onSelect, onInterrupt }: {
  visible: boolean; scope: string; tasks: TaskProjection[]; refreshing: boolean; error: string | null;
  result: { id: string; text: string; loading: boolean; error: string | null } | null;
  onClose: () => void; onRefresh: () => void; onSelect: (id: string) => void; onInterrupt: (id: string) => void;
}) {
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ scope: string; id: string } | null>(null);
  const selected = visible && selection?.scope === scope ? selection.id : null;
  const confirm = visible && confirmation?.scope === scope ? confirmation.id : null;
  const task = tasks.find(item => item.id === selected);
  const displayedResult = result?.id === selected ? result : null;
  return <Sheet visible={visible} title="Background tasks" onClose={() => { setSelection(null); setConfirmation(null); onClose(); }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={ui.muted}>Tasks observed in this conversation. Refresh checks the current connection; older tasks may be unavailable.</Text>
      <Button label={refreshing ? 'Refreshing…' : 'Refresh'} secondary disabled={refreshing} onPress={onRefresh} />
      {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
      {!tasks.length && !refreshing ? <Text style={ui.muted}>No tasks observed in this conversation yet.</Text> : null}
      {tasks.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.goal}, ${labels[item.status]}`} onPress={() => { setSelection({ scope, id: item.id }); setConfirmation(null); onSelect(item.id); }} style={{ backgroundColor: colors.raised, borderRadius: 16, padding: 14, gap: 5, borderWidth: selected === item.id ? 1 : 0, borderColor: colors.accent }}>
        <Text style={[ui.text, { fontWeight: '700' }]}>{item.goal}</Text>
        <Text style={{ color: item.status === 'failed' ? colors.danger : colors.accent, fontSize: 13 }}>{labels[item.status]}</Text>
      </Pressable>)}
      {task ? <View style={{ gap: 10, paddingTop: 8 }}>
        <Text accessibilityRole="header" style={[ui.heading, { fontSize: 18 }]}>Task result</Text>
        {task.summary ? <Text style={ui.text}>{task.summary}</Text> : null}
        {displayedResult?.loading ? <Text style={ui.muted}>Loading transcript…</Text> : null}
        {displayedResult?.error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{displayedResult.error}</Text> : null}
        {displayedResult?.text ? <Text selectable style={ui.text}>{displayedResult.text}</Text> : null}
        {!displayedResult?.loading && !displayedResult?.text && !displayedResult?.error && !task.summary ? <Text style={ui.muted}>No result available yet.</Text> : null}
        {task.status === 'running' && confirm !== task.id ? <Button label="Stop this task" secondary onPress={() => setConfirmation({ scope, id: task.id })} /> : null}
        {task.status === 'running' && confirm === task.id ? <View style={{ gap: 8 }}>
          <Text style={ui.text}>Request this task to stop? The task may still finish before the request takes effect.</Text>
          <Button label="Request stop" onPress={() => { const id = task.id; setConfirmation(null); onInterrupt(id); }} />
          <Button label="Keep running" secondary onPress={() => setConfirmation(null)} />
        </View> : null}
      </View> : null}
    </ScrollView>
  </Sheet>;
}
