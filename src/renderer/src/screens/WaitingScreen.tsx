import { TasksScreen } from './TasksScreen'

/** Waiting on: the Tasks screen showing only items waiting on someone, longest waiting first. */
export function WaitingScreen() {
  return <TasksScreen list="waiting" />
}
