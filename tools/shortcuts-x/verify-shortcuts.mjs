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
const automaticReceiverUnsignedPath = resolve(
  toolsDirectory,
  'Poolside Pulse X Automatic Receiver_unsigned.shortcut'
);
const automaticReceiverSourcePath = resolve(
  toolsDirectory,
  'poolside-pulse-x-automatic-receiver.cherri'
);
const announcementSignedPath = resolve(
  projectDirectory,
  'public/shortcuts/poolside-pulse-x-announcement.shortcut'
);
const recoverySignedPath = resolve(
  projectDirectory,
  'public/shortcuts/poolside-pulse-x-recovery.shortcut'
);
const automaticReceiverSignedPath = resolve(
  projectDirectory,
  'public/shortcuts/poolside-pulse-x-automatic-receiver.shortcut'
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

function referencedOutputUuids(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) referencedOutputUuids(item, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (typeof value.OutputUUID === 'string') found.add(value.OutputUUID);
  for (const nested of Object.values(value)) referencedOutputUuids(nested, found);
  return found;
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

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const announcement = readPlist(announcementUnsignedPath);
const recovery = readPlist(recoveryUnsignedPath);
const automaticReceiver = readPlist(automaticReceiverUnsignedPath);
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
assert.equal(
  recoveryActions[8].WFWorkflowActionParameters.WFConditionalActionString,
  '1'
);
assert.equal(recoveryActions[8].WFWorkflowActionParameters.WFNumberValue, undefined);
assert.equal(
  recoveryActions[8].WFWorkflowActionParameters.WFInput.Variable.Value
    .Aggrandizements[0].CoercionItemClass,
  'WFStringContentItem'
);
assert.equal(recoveryActions[18].WFWorkflowActionParameters.WFCondition, 4);
assert.equal(
  recoveryActions[18].WFWorkflowActionParameters.WFConditionalActionString,
  '1'
);
assert.equal(recoveryActions[18].WFWorkflowActionParameters.WFNumberValue, undefined);
assert.equal(
  recoveryActions[18].WFWorkflowActionParameters.WFInput.Variable.Value
    .Aggrandizements[0].CoercionItemClass,
  'WFStringContentItem'
);

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

const automaticActions = automaticReceiver.WFWorkflowActions;
assert.equal(automaticActions.length, 121);

assert.equal(
  automaticActions[0].WFWorkflowActionParameters.WFGetFilePath,
  'Poolside Pulse X/receiver-token.txt'
);
assert.equal(automaticActions[0].WFWorkflowActionParameters.WFFileErrorIfNotFound, false);
assert.equal(automaticActions[3].WFWorkflowActionParameters.WFCondition, 8);
assert.equal(
  automaticActions[3].WFWorkflowActionParameters.WFConditionalActionString,
  'ppxrx_'
);
assert.equal(automaticActions[10].WFWorkflowActionParameters.WFCountType, 'Characters');
assert.equal(automaticActions[11].WFWorkflowActionParameters.WFNumberValue, 49);
assert.match(
  automaticActions[12].WFWorkflowActionParameters.WFAskActionPrompt,
  /six-digit Receiver pairing code/
);
assert.equal(
  automaticActions[12].WFWorkflowActionParameters.WFInputType,
  'Text',
  'Automatic Receiver pairing input must declare a Text type'
);
assert.equal(
  automaticActions[13].WFWorkflowActionParameters.WFURL,
  'https://poolside-pulse-x-receiver.vercel.app/api/email-wake-register-x?v=x'
);
assert.equal(automaticActions[13].WFWorkflowActionParameters.WFHTTPMethod, 'POST');
assert.equal(automaticActions[17].WFWorkflowActionParameters.WFCondition, 8);
assert.equal(
  automaticActions[17].WFWorkflowActionParameters.WFConditionalActionString,
  'ppxrx_'
);
assert.equal(automaticActions[19].WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
assert.equal(automaticActions[23].WFWorkflowActionParameters.WFCountType, 'Characters');
assert.equal(automaticActions[24].WFWorkflowActionParameters.WFNumberValue, 49);
assert.equal(automaticActions[25].WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
assert.equal(
  automaticActions[30].WFWorkflowActionParameters.WFFileDestinationPath,
  'Poolside Pulse X/receiver-token.txt'
);
assert.equal(automaticActions[30].WFWorkflowActionParameters.WFSaveFileOverwrite, true);
assert.equal(
  automaticActions[34].WFWorkflowActionParameters.WFURL,
  'https://poolside-pulse-x-receiver.vercel.app/api/email-wake-claim-x?v=x'
);
assert.equal(automaticActions[34].WFWorkflowActionParameters.WFHTTPMethod, 'POST');
assert.match(
  JSON.stringify(automaticActions[34].WFWorkflowActionParameters.WFHTTPHeaders),
  /Authorization/
);
assert.match(
  JSON.stringify(automaticActions[34].WFWorkflowActionParameters.WFHTTPHeaders),
  /Bearer/
);
assert.equal(
  automaticActions.filter(
    action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.repeat.count'
  ).length,
  0,
  'Automatic Receiver must handle one command per background automation'
);
assert.equal(automaticActions[36].WFWorkflowActionParameters.WFDictionaryKey, 'pending');
assert.equal(automaticActions[37].WFWorkflowActionParameters.WFCondition, 5);
assert.equal(
  automaticActions[37].WFWorkflowActionParameters.WFConditionalActionString,
  '1'
);
assert.equal(automaticActions[37].WFWorkflowActionParameters.WFNumberValue, undefined);
assert.equal(
  automaticActions[37].WFWorkflowActionParameters.WFInput.Variable.Value
    .Aggrandizements[0].CoercionItemClass,
  'WFStringContentItem'
);
assert.ok(
  referencedOutputUuids(automaticActions[37].WFWorkflowActionParameters)
    .has(automaticActions[36].WFWorkflowActionParameters.UUID)
);
assert.equal(automaticActions[38].WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
assert.ok(getValueAction(automaticReceiver, 'pending'));
assert.ok(getValueAction(automaticReceiver, 'action'));
assert.ok(getValueAction(automaticReceiver, 'audioUrl'));
assert.ok(getValueAction(automaticReceiver, 'executeUrl'));
assert.ok(getValueAction(automaticReceiver, 'restoreUrl'));
assert.ok(getValueAction(automaticReceiver, 'receiptUrl'));
assert.ok(getValueAction(automaticReceiver, 'reclaimed'));

// Recovery-only attempts never replay speech. They resume while muted,
// applies the command fallback before networking, fetches the latest target,
// and then records a truthful recovered failure.
assert.equal(automaticActions[51].WFWorkflowActionParameters.WFVolume, 0);
assert.equal(automaticActions[52].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Play');
assert.equal(automaticActions[53].WFWorkflowActionParameters.WFDelayTime, 1);
assert.equal(
  actionOutputUuid(automaticActions[54].WFWorkflowActionParameters.WFVolume),
  automaticActions[50].WFWorkflowActionParameters.UUID
);
assert.equal(
  actionOutputUuid(automaticActions[59].WFWorkflowActionParameters.WFVolume),
  automaticActions[58].WFWorkflowActionParameters.UUID
);
for (const action of automaticActions.slice(50, 64)) {
  assert.notEqual(
    action.WFWorkflowActionParameters?.WFVolume,
    1,
    'Recovery-only flow must never set the Receiver to 100%'
  );
  assert.notEqual(
    action.WFWorkflowActionParameters?.WFPlayPauseBehavior,
    'Pause',
    'Recovery-only flow must never pause the music bed'
  );
  assert.notEqual(
    action.WFWorkflowActionIdentifier,
    'is.workflow.actions.playsound',
    'Recovery-only flow must never replay announcement audio'
  );
}

// Unknown action types stop instead of falling into announcement playback.
assert.equal(automaticActions[65].WFWorkflowActionParameters.WFCondition, 5);
assert.equal(
  automaticActions[65].WFWorkflowActionParameters.WFConditionalActionString,
  'announce'
);
assert.equal(automaticActions[66].WFWorkflowActionIdentifier, 'is.workflow.actions.exit');

// A reclaimed attempt first repairs the bed at the command fallback level.
assert.equal(automaticActions[71].WFWorkflowActionParameters.WFVolume, 0);
assert.equal(automaticActions[72].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Play');
assert.equal(automaticActions[73].WFWorkflowActionParameters.WFDelayTime, 1);
assert.equal(
  actionOutputUuid(automaticActions[74].WFWorkflowActionParameters.WFVolume),
  automaticActions[68].WFWorkflowActionParameters.UUID
);
assert.equal(automaticActions[70].WFWorkflowActionParameters.WFCondition, 4);
assert.equal(
  automaticActions[70].WFWorkflowActionParameters.WFConditionalActionString,
  '1'
);
assert.equal(automaticActions[70].WFWorkflowActionParameters.WFNumberValue, undefined);
assert.equal(
  automaticActions[70].WFWorkflowActionParameters.WFInput.Variable.Value
    .Aggrandizements[0].CoercionItemClass,
  'WFStringContentItem'
);
assert.ok(
  referencedOutputUuids(automaticActions[70].WFWorkflowActionParameters)
    .has(automaticActions[69].WFWorkflowActionParameters.UUID)
);

// Normal attempts download all audio, then authorize this exact attempt,
// before the first announcement-related volume or playback mutation.
assert.equal(automaticActions[79].WFWorkflowActionParameters.CustomOutputName, 'announcementAudio');
assert.equal(automaticActions[79].WFWorkflowActionParameters.WFHTTPMethod, 'GET');
assert.ok(
  referencedOutputUuids(automaticActions[79].WFWorkflowActionParameters)
    .has(automaticActions[78].WFWorkflowActionParameters.UUID)
);
assert.equal(automaticActions[81].WFWorkflowActionParameters.WFHTTPMethod, 'GET');
assert.ok(
  referencedOutputUuids(automaticActions[81].WFWorkflowActionParameters)
    .has(automaticActions[80].WFWorkflowActionParameters.UUID)
);
assert.equal(automaticActions[81].WFWorkflowActionParameters.CustomOutputName, 'executeResponse');
assert.equal(automaticActions[82].WFWorkflowActionParameters.CustomOutputName, 'executeDictionary');
assert.equal(automaticActions[83].WFWorkflowActionParameters.WFDictionaryKey, 'authorized');
assert.equal(automaticActions[84].WFWorkflowActionParameters.WFDictionaryKey, 'receiverContract');
assert.equal(automaticActions[85].WFWorkflowActionParameters.WFDictionaryKey, 'executionAttempt');
assert.equal(automaticActions[87].WFWorkflowActionParameters.WFDictionaryKey, 'executionAttempt');
assert.equal(
  automaticActions[89].WFWorkflowActionParameters.WFConditions.Value
    .WFActionParameterFilterPrefix,
  0
);
const authorizationConditions =
  automaticActions[89].WFWorkflowActionParameters.WFConditions.Value
    .WFActionParameterFilterTemplates;
assert.equal(authorizationConditions.length, 3);
assert.equal(authorizationConditions[0].WFCondition, 5);
assert.equal(authorizationConditions[0].WFConditionalActionString, '1');
assert.equal(authorizationConditions[0].WFNumberValue, undefined);
assert.equal(
  authorizationConditions[0].WFInput.Variable.Value
    .Aggrandizements[0].CoercionItemClass,
  'WFStringContentItem'
);
assert.ok(
  referencedOutputUuids(authorizationConditions)
    .has(automaticActions[83].WFWorkflowActionParameters.UUID)
);
assert.ok(
  referencedOutputUuids(authorizationConditions)
    .has(automaticActions[84].WFWorkflowActionParameters.UUID)
);
assert.ok(
  referencedOutputUuids(authorizationConditions)
    .has(automaticActions[86].WFWorkflowActionParameters.UUID)
);
assert.ok(
  referencedOutputUuids(authorizationConditions)
    .has(automaticActions[88].WFWorkflowActionParameters.UUID)
);
assert.equal(automaticActions[90].WFWorkflowActionIdentifier, 'is.workflow.actions.exit');

assert.equal(automaticActions[94].WFWorkflowActionParameters.WFVolume, 0);
assert.equal(automaticActions[95].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Pause');
assert.equal(automaticActions[96].WFWorkflowActionParameters.WFDelayTime, 1);
assert.equal(automaticActions[97].WFWorkflowActionParameters.WFVolume, 1);
assert.equal(
  actionOutputUuid(automaticActions[98].WFWorkflowActionParameters.WFInput),
  automaticActions[79].WFWorkflowActionParameters.UUID
);
assert.equal(automaticActions[99].WFWorkflowActionParameters.WFVolume, 0);
assert.equal(automaticActions[100].WFWorkflowActionParameters.WFPlayPauseBehavior, 'Play');
assert.equal(automaticActions[101].WFWorkflowActionParameters.WFDelayTime, 1);
assert.equal(
  actionOutputUuid(automaticActions[102].WFWorkflowActionParameters.WFVolume),
  automaticActions[68].WFWorkflowActionParameters.UUID
);
assert.ok(
  referencedOutputUuids(automaticActions[104].WFWorkflowActionParameters)
    .has(automaticActions[103].WFWorkflowActionParameters.UUID)
);
assert.equal(
  actionOutputUuid(automaticActions[107].WFWorkflowActionParameters.WFVolume),
  automaticActions[106].WFWorkflowActionParameters.UUID
);

for (const receiptIndex of [47, 63, 111]) {
  const receipt = automaticActions[receiptIndex];
  assert.equal(receipt.WFWorkflowActionParameters.WFHTTPMethod, 'POST');
  assert.equal(receipt.WFWorkflowActionParameters.WFHTTPBodyType, 'JSON');
  const values = dictionaryValues(receipt);
  assert.equal(values.receiverContract, 'poolside-pulse-x-wake-v1');
  assert.equal(values.volumeRestored, true);
}
assert.equal(dictionaryValues(automaticActions[47]).musicResumed, false);
assert.equal(dictionaryValues(automaticActions[47]).status, 'completed');
assert.equal(dictionaryValues(automaticActions[63]).status, 'failed');
assert.equal(
  dictionaryValues(automaticActions[63]).failureCode,
  'retry_exhausted_recovered'
);
assert.equal(dictionaryValues(automaticActions[63]).musicResumed, true);
assert.equal(dictionaryValues(automaticActions[111]).status, 'completed');
assert.equal(dictionaryValues(automaticActions[111]).musicResumed, true);

const automaticConditionalGroups = new Map();
for (const action of automaticActions.filter(
  (entry) => entry.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional'
)) {
  const { GroupingIdentifier, WFControlFlowMode } = action.WFWorkflowActionParameters;
  assert.ok(GroupingIdentifier, 'Automatic Receiver conditional is missing its group identifier');
  const modes = automaticConditionalGroups.get(GroupingIdentifier) || [];
  modes.push(WFControlFlowMode);
  automaticConditionalGroups.set(GroupingIdentifier, modes);
}
assert.equal(automaticConditionalGroups.size, 10);
const automaticConditionalModes = [...automaticConditionalGroups.values()]
  .map(modes => modes.join(','))
  .sort();
assert.deepEqual(
  automaticConditionalModes,
  [
    '0,1,2',
    '0,1,2',
    '0,1,2',
    '0,1,2',
    '0,1,2',
    '0,1,2',
    '0,2',
    '0,2',
    '0,2',
    '0,2'
  ]
);

assert.equal(manifest.receiverContract, 'poolside-pulse-x-audio-v4');
assert.equal(manifest.automaticReceiverContract, 'poolside-pulse-x-wake-v1');
assert.equal(
  sha256File(automaticReceiverSourcePath),
  manifest.signedFiles.automaticReceiver.sourceSha256
);
assert.equal(
  sha256File(automaticReceiverUnsignedPath),
  manifest.signedFiles.automaticReceiver.unsignedSha256
);
assert.equal(
  manifest.signedFiles.automaticReceiver.signedFromUnsignedSha256,
  manifest.signedFiles.automaticReceiver.unsignedSha256
);

const serializedWorkflows = JSON.stringify([announcement, recovery, automaticReceiver]);
for (const forbidden of [
  'api.pushcut.io',
  'pushcut',
  'PUSHCUT_API_KEY',
  'APPLE_MUSIC_PRIVATE_KEY',
  'BEGIN PRIVATE KEY'
]) {
  assert.equal(serializedWorkflows.includes(forbidden), false, `Found secret marker: ${forbidden}`);
}

verifySignedFile(announcementSignedPath, manifest.signedFiles.announcement.sha256);
verifySignedFile(recoverySignedPath, manifest.signedFiles.recovery.sha256);
verifySignedFile(
  automaticReceiverSignedPath,
  manifest.signedFiles.automaticReceiver.sha256
);

console.log(
  `Verified ${announcementActions.length} announcement actions, ` +
    `${recoveryActions.length} recovery actions, ` +
    `${automaticActions.length} automatic Receiver actions, mute-first ordering, ` +
    'v4 and wake-v1 receipts, and all three Apple signatures.'
);
