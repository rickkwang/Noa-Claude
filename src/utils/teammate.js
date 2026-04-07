export { createTeammateContext, getTeammateContext, isInProcessTeammate, runWithTeammateContext } from './teammateContext.js';

export function getParentSessionId() {
  return undefined;
}

export function setDynamicTeamContext(ctx) {
}

export function clearDynamicTeamContext() {
}

export function getDynamicTeamContext() {
  return undefined;
}

export function getAgentId() {
  return undefined;
}

export function getAgentName() {
  return undefined;
}

export function getTeamName(teamContext) {
  return teamContext?.teamName;
}

export function isTeammate() {
  return false;
}

export function getTeammateColor() {
  return undefined;
}

export function isPlanModeRequired() {
  return false;
}

export function isTeamLead(appState) {
  return false;
}

export function hasActiveInProcessTeammates(appState) {
  return false;
}

export function hasWorkingInProcessTeammates(appState) {
  return false;
}

export function waitForTeammatesToBecomeIdle() {
}
