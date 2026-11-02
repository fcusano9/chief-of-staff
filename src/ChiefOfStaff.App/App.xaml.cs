using ChiefOfStaff.Core.Services;
using ChiefOfStaff.Data;
using ChiefOfStaff.Data.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;

namespace ChiefOfStaff.App;

public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;
    public static MainWindow MainWindow { get; private set; } = null!;

    public App()
    {
        InitializeComponent();
        Services = ConfigureServices();
        UnhandledException += (_, e) => LogCrash(e.Exception);
    }

    /// <summary>Appends unhandled errors to crash.log in the data folder so failures can be diagnosed.</summary>
    private static void LogCrash(Exception ex)
    {
        try { File.AppendAllText(Path.Combine(AppPaths.DataFolder, "crash.log"), $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {ex}{Environment.NewLine}{Environment.NewLine}"); }
        catch (IOException) { }
    }

    public static T Get<T>() where T : notnull => Services.GetRequiredService<T>();

    private static IServiceProvider ConfigureServices()
    {
        Directory.CreateDirectory(AppPaths.DataFolder);
        var services = new ServiceCollection();
        services.AddDbContextFactory<AppDbContext>(o => o.UseSqlite($"Data Source={AppPaths.DatabasePath}"));
        services.AddSingleton(new SettingsService(AppPaths.SettingsPath));
        services.AddSingleton(new BackupService(AppPaths.DatabasePath));
        services.AddSingleton<PriorityEngine>();
        services.AddSingleton<WorkItemService>();
        services.AddSingleton<ProjectService>();
        services.AddSingleton<PersonService>();
        services.AddSingleton<BriefService>();
        return services.BuildServiceProvider();
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        await using (var db = await Get<IDbContextFactory<AppDbContext>>().CreateDbContextAsync())
        {
            await db.Database.MigrateAsync();
        }
        await Get<WorkItemService>().RecomputeAllAsync();

        MainWindow = new MainWindow();
        MainWindow.Activate();

        _ = Task.Run(RunDailyBackupIfDue);
    }

    /// <summary>Backs up to OneDrive at most once a day, on startup. The scheduler arrives in milestone 3.</summary>
    private static void RunDailyBackupIfDue()
    {
        var settings = Get<SettingsService>();
        if (settings.Current.LastBackupAt is { } last && DateTime.Now - last < TimeSpan.FromHours(20)) return;
        try
        {
            Get<BackupService>().CreateBackup(settings.Current.BackupFolder ?? AppPaths.DefaultBackupFolder, settings.Current.BackupsToKeep);
            settings.Current.LastBackupAt = DateTime.Now;
            settings.Save();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Backup failed: {ex}");
        }
    }
}
