import { BOT_COMMANDS, BotCommandsService } from './bot-commands.service';

describe('BotCommandsService', () => {
  it('writes the same menu to the default, private and group scopes', async () => {
    const setMyCommands = jest.fn().mockResolvedValue(true);
    await new BotCommandsService(
      { telegram: { setMyCommands } } as never,
      { log: jest.fn() } as never,
    ).onApplicationBootstrap();

    expect(setMyCommands.mock.calls.map(([, extra]) => extra.scope.type)).toEqual([
      'default',
      'all_private_chats',
      'all_group_chats',
    ]);
    setMyCommands.mock.calls.forEach(([commands]) => expect(commands).toBe(BOT_COMMANDS));
  });

  it('does not stop the bot when Telegram refuses', async () => {
    const error = jest.fn();
    const setMyCommands = jest.fn().mockRejectedValue(new Error('429'));
    await new BotCommandsService({ telegram: { setMyCommands } } as never, { error } as never).onApplicationBootstrap();
    expect(error).toHaveBeenCalled();
  });

  it('describes /stop as unsubscribing, not subscribing', () => {
    expect(BOT_COMMANDS.find(c => c.command === 'stop')?.description).toBe('Відписатися від сповіщень');
  });

  it('lists no admin-only command', () => {
    expect(BOT_COMMANDS.map(c => c.command)).not.toEqual(expect.arrayContaining(['statusrequest']));
    expect(BOT_COMMANDS.map(c => c.command)).not.toContain('diag');
  });
});
