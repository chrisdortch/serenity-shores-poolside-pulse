import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(toolsDirectory, '..', '..');

const announcementUnsignedPath = resolve(
  toolsDirectory,
  'Poolside Pulse X Announcement_unsigned.shortcut'
);
const recoveryUnsignedPath = resolve(
  toolsDirectory,
  'Poolside Pulse X Recovery_unsigned.shortcut'
);
const announcementSignedPath = resolve(
  projectDirectory,
  'public/shortcuts/poolside-pulse-x-announcement.shortcut'
);
const recoverySignedPath = resolve(
  projectDirectory,
  'public/shortcuts/poolside-pulse-x-recovery.shortcut'
);
const manifestPath = resolve(toolsDirectory, 'manifest.json');

function readPlist(path) {
  const result = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || `Unable to inspect ${path}`);
  return JSON.parse(result.stdout);
}

function actionIdentifiers(workflow) {
  return workflow.WFWorkflowActions.map((action) => action.WFWorkflowActionIdentifier);
}

function actionOutputUuid(value) {
  return value?.Value?.OutputUUID || value?.Value?.Variable?.Value?.OutputUUID || '';
}

function getValueAction(workflow, key) {
  return workflow.WFWorkflowActions.find(
    (action) =>
      action.WFWorkflowActionIdentifier === 'is.workflow.actions.getvalueforkey' &&
      action.WFWorkflowActionParameters?.WFDictionaryKey === key
  );
}

function dictionaryValues(action) {
  const items =
    action.WFWorkflowActionParameters?.WFJSONValues?.Value?.WFDictionaryFieldValueItems || [];
  return Object.fromEntries(
    items.map((item) => [
      item.WFKey?.Value?.string,
      item.WFValue?.Value?.string ?? item.WFValue?.Value
    ])
  );
}

function verifySignedFile(path, expectedHash) {
  const file = readFileSync(path);
  assert.ok(file.length > 10_000, `${path} is unexpectedly small`);
  assert.equal(file.subarray(0, 4).toString('ascii'), 'AEA1', `${path} is not Apple signed`);
  assert.equal(createHash('sha256').update(file).digest('hex'), expectedHash);
}

const announcement = readPlist(announcementUnsignedPath);
const recovery = readPlist(recoveryUnsignedPath);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

assert.deepEqual(actionIdentifiers(announcement), [
  'is.workflow.actions.detect.dictionary',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.downloadurl',
  'is.workflow.actions.pausemusic',
  'is.workflow.actions.delay',
  'is.workflow.actions.setvolume',
  'is.workflow.actions.playsound',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.downloadurl',
  'is.workflow.actions.detect.dictionary',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.setvolume',
  'is.workflow.actions.pausemusic',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.number',
  'is.workflow.actions.downloadurl'
]);

const announcementActions = announcement.WFWorkflowActions;
const audioUrl = getValueAction(announcement, 'audioUrl');
const restoreUrl = getValueAction(announcement, 'restoreUrl');
const musicLevel = getValueAction(announcement, 'musicLevel');
const receiptUrl = getValueAction(announcement, 'receiptUrl');
const musicPercent = getValueAction(announcement, 'musicPercent');

for (const action of [audioUrl, restoreUrl, musicLevel, receiptUrl, musicPercent]) {
  assert.ok(action, 'Announcement is missing a required dictionary value');
}

assert.equal(announcementActions[3].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Pause');
assert.equal(announcementActions[4].WFWorkflowActionParameters.WFDelayTime, 1);
assert.equal(announcementActions[5].WFWorkflowActionParameters.WFVolume, 1);
assert.equal(
  actionOutputUuid(announcementActions[6].WFWorkflowActionParameters.WFInput),
  announcementActions[2].WFWorkflowActionParameters.UUID
);
assert.equal(
  actionOutputUuid(announcementActions[11].WFWorkflowActionParameters.WFVolume),
  musicLevel.WFWorkflowActionParameters.UUID
);
assert.equal(announcementActions[12].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Play');
assert.equal(
  actionOutputUuid(announcementActions[15].WFWorkflowActionParameters.WFNumberActionNumber),
  musicPercent.WFWorkflowActionParameters.UUID
);
assert.equal(announcementActions[16].WFWorkflowActionParameters.WFHTTPMethod, 'POST');
assert.equal(announcementActions[16].WFWorkflowActionParameters.WFHTTPBodyType, 'JSON');
const completionValues = dictionaryValues(announcementActions[16]);
assert.equal(completionValues.status, 'completed');
assert.equal(completionValues.receiverContract, 'poolside-pulse-x-audio-v4');
assert.equal(completionValues.volumeRestored, true);
assert.equal(completionValues.musicResumed, true);
const completionItems =
  announcementActions[16].WFWorkflowActionParameters.WFJSONValues.Value
    .WFDictionaryFieldValueItems;
const restoredMusicPercentItem = completionItems.find(
  (item) => item.WFKey?.Value?.string === 'restoredMusicPercent'
);
assert.ok(restoredMusicPercentItem);
assert.equal(
  actionOutputUuid(restoredMusicPercentItem.WFValue),
  announcementActions[15].WFWorkflowActionParameters.UUID
);
assert.equal(
  restoredMusicPercentItem.WFValue.WFSerializationType,
  'WFTextTokenAttachment'
);

const recoveryActions = recovery.WFWorkflowActions;
assert.deepEqual(actionIdentifiers(recovery), [
  'is.workflow.actions.detect.dictionary',
  'is.workflow.actions.setvariable',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.conditional',
  'is.workflow.actions.downloadurl',
  'is.workflow.actions.detect.dictionary',
  'is.workflow.actions.setvariable',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.conditional',
  'is.workflow.actions.exit',
  'is.workflow.actions.nothing',
  'is.workflow.actions.conditional',
  'is.workflow.actions.nothing',
  'is.workflow.actions.conditional',
  'is.workflow.actions.nothing',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.setvolume',
  'is.workflow.actions.getvalueforkey',
  'is.workflow.actions.conditional',
  'is.workflow.actions.pausemusic',
  'is.workflow.actions.nothing',
  'is.workflow.actions.conditional',
  'is.workflow.actions.nothing'
]);
const conditionalGroups = new Map();
for (const action of recoveryActions.filter(
  (entry) => entry.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional'
)) {
  const { GroupingIdentifier, WFControlFlowMode } = action.WFWorkflowActionParameters;
  assert.ok(GroupingIdentifier, 'Conditional action is missing its group identifier');
  const modes = conditionalGroups.get(GroupingIdentifier) || [];
  modes.push(WFControlFlowMode);
  conditionalGroups.set(GroupingIdentifier, modes);
}
assert.equal(conditionalGroups.size, 3);
for (const modes of conditionalGroups.values()) assert.deepEqual(modes, [0, 2]);

assert.equal(recoveryActions[3].WFWorkflowActionParameters.WFCondition, 100);
assert.equal(recoveryActions[8].WFWorkflowActionParameters.WFCondition, 5);
assert.equal(recoveryActions[8].WFWorkflowActionParameters.WFNumberValue, 1);
assert.equal(recoveryActions[18].WFWorkflowActionParameters.WFCondition, 4);
assert.equal(recoveryActions[18].WFWorkflowActionParameters.WFNumberValue, 1);

const recoveryMusicLevel = recoveryActions.find(
  (action) => action.WFWorkflowActionParameters?.CustomOutputName === 'musicLevel'
);
assert.ok(recoveryMusicLevel);
assert.equal(
  actionOutputUuid(recoveryActions[16].WFWorkflowActionParameters.WFVolume),
  recoveryMusicLevel.WFWorkflowActionParameters.UUID
);
assert.equal(recoveryActions[9].WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
assert.equal(recoveryActions[19].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Play');
assert.equal(
  recoveryActions.filter(
    (action) =>
      action.WFWorkflowActionIdentifier === 'is.workflow.actions.pausemusic' &&
      action.WFWorkflowActionParameters?.WFPlayPauseBehavior === 'Play'
  ).length,
  1
);

const serializedWorkflows = JSON.stringify([announcement, recovery]);
for (const forbidden of [
  'api.pushcut.io',
  'PUSHCUT_API_KEY',
  'APPLE_MUSIC_PRIVATE_KEY',
  'BEGIN PRIVATE KEY'
]) {
  assert.equal(serializedWorkflows.includes(forbidden), false, `Found secret marker: ${forbidden}`);
}

verifySignedFile(announcementSignedPath, manifest.signedFiles.announcement.sha256);
verifySignedFile(recoverySignedPath, manifest.signedFiles.recovery.sha256);

console.log(
  `Verified ${announcementActions.length} announcement actions, ` +
    `${recoveryActions.length} recovery actions, three unique conditional groups, ` +
    'the v4 completion receipt, and both Apple signatures.'
);
