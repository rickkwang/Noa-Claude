// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
import { UserPromptMessage } from './UserPromptMessage.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
export function UserCommandMessage(t0) {
  const $ = _c(20);
  const {
    addMargin,
    param: t1
  } = t0;
  const {
    text
  } = t1;
  let t2;
  if ($[0] !== text) {
    t2 = extractTag(text, COMMAND_MESSAGE_TAG);
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const commandMessage = t2;
  let t3;
  if ($[2] !== text) {
    t3 = extractTag(text, "command-args");
    $[2] = text;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const args = t3;
  const isSkillFormat = extractTag(text, "skill-format") === "true";
  if (!commandMessage) {
    return null;
  }
  if (isSkillFormat) {
    const content_0 = `Skill(${commandMessage})`;
    let t4;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text color="subtle">{figures.pointer} </Text>;
      $[4] = t4;
    } else {
      t4 = $[4];
    }
    let t5;
    if ($[5] !== content_0 || $[6] !== t4) {
      t5 = <Text>{t4}<Text color="text">{content_0}</Text></Text>;
      $[5] = content_0;
      $[6] = t4;
      $[7] = t5;
    } else {
      t5 = $[7];
    }
    let t6;
    if ($[8] !== addMargin || $[9] !== t5) {
      t6 = <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor="userMessageBackground" paddingRight={1}>{t5}</Box>;
      $[8] = addMargin;
      $[9] = t5;
      $[10] = t6;
    } else {
      t6 = $[10];
    }
    return t6;
  }
  let t4;
  if ($[11] !== args || $[12] !== commandMessage) {
    t4 = [commandMessage, args].filter(Boolean);
    $[11] = args;
    $[12] = commandMessage;
    $[13] = t4;
  } else {
    t4 = $[13];
  }
  const content = `/${t4.join(" ")}`;
  const commandPrefix = `/${commandMessage}`;
  let t5;
  if ($[14] !== addMargin || $[15] !== commandPrefix || $[16] !== content) {
    t5 = <UserPromptMessage addMargin={addMargin} param={{
      type: 'text',
      text: content
    }} highlightedPrefix={commandPrefix} />;
    $[14] = addMargin;
    $[15] = commandPrefix;
    $[16] = content;
    $[17] = t5;
  } else {
    t5 = $[17];
  }
  return t5;
}
