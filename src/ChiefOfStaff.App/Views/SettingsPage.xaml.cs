using ChiefOfStaff.Data;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

public sealed partial class SettingsPage : Page
{
    private readonly SettingsService _settings = App.Get<SettingsService>();

    public SettingsPage() => InitializeComponent();

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        var s = _settings.Current;
        DueWeight.Value = s.PriorityWeights.DueDate;
        RequesterWeight.Value = s.PriorityWeights.Requester;
        StaleWeight.Value = s.PriorityWeights.Staleness;
        BackupFolderBox.Text = s.BackupFolder ?? AppPaths.DefaultBackupFolder;
        KeepBox.Value = s.BackupsToKeep;
        BackupStatus.Text = s.LastBackupAt is { } last ? $"Last backup {last:MMM d, yyyy h:mm tt}" : "No backup yet";
        DataPathText.Text = $"Database: {AppPaths.DatabasePath}";
    }

    private async void SaveWeights_Click(object sender, RoutedEventArgs e)
    {
        var w = _settings.Current.PriorityWeights;
        w.DueDate = (int)DueWeight.Value;
        w.Requester = (int)RequesterWeight.Value;
        w.Staleness = (int)StaleWeight.Value;
        _settings.Save();
        await App.Get<WorkItemService>().RecomputeAllAsync();
        WeightsStatus.Text = "Saved; priorities recalculated";
    }

    private void SaveBackup_Click(object sender, RoutedEventArgs e)
    {
        SaveBackupSettings();
        BackupStatus.Text = "Saved";
    }

    private void SaveBackupSettings()
    {
        var folder = BackupFolderBox.Text.Trim();
        _settings.Current.BackupFolder = folder.Length == 0 || folder == AppPaths.DefaultBackupFolder ? null : folder;
        _settings.Current.BackupsToKeep = double.IsNaN(KeepBox.Value) ? 30 : (int)KeepBox.Value;
        _settings.Save();
    }

    private async void BackupNow_Click(object sender, RoutedEventArgs e)
    {
        SaveBackupSettings();
        var s = _settings.Current;
        var folder = s.BackupFolder ?? AppPaths.DefaultBackupFolder;
        try
        {
            var path = await Task.Run(() => App.Get<BackupService>().CreateBackup(folder, s.BackupsToKeep));
            s.LastBackupAt = DateTime.Now;
            _settings.Save();
            BackupStatus.Text = $"Backed up to {path}";
        }
        catch (Exception ex)
        {
            BackupStatus.Text = "Backup failed: " + ex.Message;
        }
    }

    private void OpenBackupFolder_Click(object sender, RoutedEventArgs e)
    {
        var folder = _settings.Current.BackupFolder ?? AppPaths.DefaultBackupFolder;
        Directory.CreateDirectory(folder);
        System.Diagnostics.Process.Start("explorer.exe", folder);
    }
}
