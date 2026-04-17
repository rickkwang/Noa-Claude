// @ts-nocheck
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { ProviderProfile, ProviderType } from '../../utils/providerProfile.js'
import {
  loadProviderProfiles,
  addProviderProfile,
  updateProviderProfile,
  deleteProviderProfile,
  getActiveProviderProfile,
  setActiveProviderProfile,
  applyActiveProviderProfileEnv,
  PROVIDER_TYPE_LABELS,
  PROVIDER_TYPE_DEFAULTS,
} from '../../utils/providerProfile.js'

type View = 'list' | 'add' | 'edit' | 'delete'

function ProviderList({
  profiles,
  onSelect,
  onAdd,
  activeProfileId,
}: {
  profiles: ProviderProfile[]
  onSelect: (profile: ProviderProfile) => void
  onAdd: () => void
  activeProfileId?: string | null
}): React.ReactNode {
  if (profiles.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold marginBottom={1}>
          Provider Profiles
        </Text>
        <Text dimColor>No provider profiles configured.</Text>
        <Text dimColor marginTop={1}>
          Press Enter or type 'add' to create one.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold marginBottom={1}>
        Provider Profiles ({profiles.length})
      </Text>
      {profiles.map((profile, index) => (
        <Box
          key={profile.id}
          flexDirection="column"
          marginLeft={2}
          marginBottom={1}
          borderStyle="round"
          padding={1}
        >
          <Box flexDirection="row" gap={2}>
            <Text bold>[{index + 1}]</Text>
            <Text bold>{profile.name}</Text>
            <Text dimColor>({PROVIDER_TYPE_LABELS[profile.type]})</Text>
            {profile.id === activeProfileId && <Text color="green">active</Text>}
          </Box>
          <Box flexDirection="column" marginLeft={4}>
            {profile.baseUrl && (
              <Text dimColor>URL: {profile.baseUrl}</Text>
            )}
            {profile.model && <Text dimColor>Model: {profile.model}</Text>}
            {profile.apiKey && (
              <Text dimColor>API Key: {'*'.repeat(8)}
                {profile.apiKey.slice(-4)}
              </Text>
            )}
          </Box>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Commands: use &lt;id&gt;, add, edit &lt;id&gt;, delete &lt;id&gt;</Text>
      </Box>
    </Box>
  )
}

function ProviderForm({
  profile,
  onSave,
  onCancel,
  isEdit,
}: {
  profile?: Partial<ProviderProfile>
  onSave: (data: Omit<ProviderProfile, 'id'>) => void
  onCancel: () => void
  isEdit?: boolean
}): React.ReactNode {
  const [name, setName] = React.useState(profile?.name || '')
  const [type, setType] = React.useState<ProviderType>(profile?.type || 'openai')
  const [baseUrl, setBaseUrl] = React.useState(profile?.baseUrl || '')
  const [apiKey, setApiKey] = React.useState(profile?.apiKey || '')
  const [model, setModel] = React.useState(profile?.model || '')

  React.useEffect(() => {
    if (!isEdit && PROVIDER_TYPE_DEFAULTS[type]) {
      const defaults = PROVIDER_TYPE_DEFAULTS[type]
      if (!baseUrl && defaults.baseUrl) {
        setBaseUrl(defaults.baseUrl)
      }
      if (!model && defaults.model) {
        setModel(defaults.model)
      }
    }
  }, [type, isEdit, baseUrl, model])

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      type,
      baseUrl: baseUrl.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      model: model.trim() || undefined,
    })
  }

  const providerTypes = Object.entries(PROVIDER_TYPE_LABELS) as [ProviderType, string][]

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold marginBottom={1}>
        {isEdit ? 'Edit Provider' : 'Add Provider'}
      </Text>

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text>Name: {name || '(required)'}</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text>Type: {PROVIDER_TYPE_LABELS[type]}</Text>
        <Box flexDirection="row" gap={1} marginLeft={2} marginTop={1}>
          {providerTypes.slice(0, 4).map(([t, label]) => (
            <Text
              key={t}
              dimColor={type !== t}
              color={type === t ? 'cyan' : undefined}
            >
              {label}
            </Text>
          ))}
        </Box>
        <Box flexDirection="row" gap={1} marginLeft={2}>
          {providerTypes.slice(4).map(([t, label]) => (
            <Text
              key={t}
              dimColor={type !== t}
              color={type === t ? 'cyan' : undefined}
            >
              {label}
            </Text>
          ))}
        </Box>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text>Base URL: {baseUrl || '(optional)'}</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text>Model: {model || '(optional)'}</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text>API Key: {apiKey ? '*'.repeat(12) : '(optional)'}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter name, then select type (1-7), enter URL, model, API key
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Enter to save, Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function DeleteConfirm({
  profile,
  onConfirm,
  onCancel,
}: {
  profile: ProviderProfile
  onConfirm: () => void
  onCancel: () => void
}): React.ReactNode {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="red" marginBottom={1}>
        Delete Provider?
      </Text>
      <Text>
        Are you sure you want to delete "{profile.name}"?
      </Text>
      <Text dimColor marginTop={1}>
        This action cannot be undone.
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to confirm, Esc to cancel</Text>
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (
  onDone,
  _context,
  args,
): Promise<React.ReactNode> => {
  const trimmedArgs = args.trim()
  const [command, ...commandArgs] = trimmedArgs.split(/\s+/)
  const subCommand = command.toLowerCase()
  const idArg = commandArgs[0]

  const [profiles, setProfiles] = React.useState<ProviderProfile[]>([])
  const [activeProfileId, setActiveProfileId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<View>('list')
  const [selectedProfile, setSelectedProfile] = React.useState<ProviderProfile | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    loadProviderProfiles().then(p => {
      setProfiles(p)
      setActiveProfileId(getActiveProviderProfile(p)?.id ?? null)
      setLoading(false)
    })
  }, [])

  const handleAdd = async (data: Omit<ProviderProfile, 'id'>) => {
    const created = await addProviderProfile(data)
    if (profiles.length === 0) {
      await setActiveProviderProfile(created.id)
      await applyActiveProviderProfileEnv()
    }
    const updated = await loadProviderProfiles()
    setProfiles(updated)
    setActiveProfileId(getActiveProviderProfile(updated)?.id ?? null)
    setView('list')
    onDone(`Added provider: ${data.name}`, { display: 'system' })
  }

  const handleEdit = async (data: Omit<ProviderProfile, 'id'>) => {
    if (!selectedProfile) return
    await updateProviderProfile(selectedProfile.id, data)
    await applyActiveProviderProfileEnv()
    const updated = await loadProviderProfiles()
    setProfiles(updated)
    setActiveProfileId(getActiveProviderProfile(updated)?.id ?? null)
    setSelectedProfile(null)
    setView('list')
    onDone(`Updated provider: ${data.name}`, { display: 'system' })
  }

  const handleDelete = async () => {
    if (!selectedProfile) return
    const name = selectedProfile.name
    await deleteProviderProfile(selectedProfile.id)
    await applyActiveProviderProfileEnv()
    const updated = await loadProviderProfiles()
    setProfiles(updated)
    setActiveProfileId(getActiveProviderProfile(updated)?.id ?? null)
    setSelectedProfile(null)
    setView('list')
    onDone(`Deleted provider: ${name}`, { display: 'system' })
  }

  const handleUse = async (profile: ProviderProfile) => {
    await setActiveProviderProfile(profile.id)
    await applyActiveProviderProfileEnv()
    context.onChangeAPIKey()
    context.setAppState(prev => ({
      ...prev,
      mainLoopModel: null,
      mainLoopModelForSession: null,
      authVersion: prev.authVersion + 1,
    }))
    const updated = await loadProviderProfiles()
    setProfiles(updated)
    setActiveProfileId(profile.id)
    onDone(`Activated provider: ${profile.name}`, { display: 'system' })
  }

  // Handle commands from args
  React.useEffect(() => {
    if (loading) return

    if (subCommand === 'add') {
      setView('add')
    } else if (subCommand === 'use' && idArg) {
      const profile = profiles.find(p => p.id === idArg || p.name.toLowerCase() === idArg.toLowerCase())
      if (profile) {
        void handleUse(profile)
      } else {
        onDone(`Provider not found: ${idArg}`, { display: 'system' })
      }
    } else if (subCommand === 'edit' && idArg) {
      const profile = profiles.find(p => p.id === idArg || p.name.toLowerCase() === idArg.toLowerCase())
      if (profile) {
        setSelectedProfile(profile)
        setView('edit')
      } else {
        onDone(`Provider not found: ${idArg}`, { display: 'system' })
        setView('list')
      }
    } else if (subCommand === 'delete' && idArg) {
      const profile = profiles.find(p => p.id === idArg || p.name.toLowerCase() === idArg.toLowerCase())
      if (profile) {
        setSelectedProfile(profile)
        setView('delete')
      } else {
        onDone(`Provider not found: ${idArg}`, { display: 'system' })
        setView('list')
      }
    }
  }, [loading, subCommand, idArg, profiles, onDone])

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Loading provider profiles...</Text>
      </Box>
    )
  }

  if (view === 'add') {
    return (
      <ProviderForm
        onSave={handleAdd}
        onCancel={() => setView('list')}
        isEdit={false}
      />
    )
  }

  if (view === 'edit' && selectedProfile) {
    return (
      <ProviderForm
        profile={selectedProfile}
        onSave={handleEdit}
        onCancel={() => {
          setSelectedProfile(null)
          setView('list')
        }}
        isEdit={true}
      />
    )
  }

  if (view === 'delete' && selectedProfile) {
    return (
      <DeleteConfirm
        profile={selectedProfile}
        onConfirm={handleDelete}
        onCancel={() => {
          setSelectedProfile(null)
          setView('list')
        }}
      />
    )
  }

  return (
    <ProviderList
      profiles={profiles}
      onSelect={handleUse}
      onAdd={() => setView('add')}
      activeProfileId={activeProfileId}
    />
  )
}
