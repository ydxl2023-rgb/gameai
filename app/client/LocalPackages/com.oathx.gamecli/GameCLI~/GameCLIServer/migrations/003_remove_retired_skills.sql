-- Remove retired provider-specific skills without changing task history or applied migrations.
DELETE FROM gameai.agent_skills WHERE skill_key IN ('gameai-jira', 'gameai-jira-issue-writing');
DELETE FROM gameai.skills WHERE skill_key IN ('gameai-jira', 'gameai-jira-issue-writing');
