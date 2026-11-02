using Microsoft.Data.Sqlite;

namespace ChiefOfStaff.Data.Services;

/// <summary>
/// Copies a consistent snapshot of the live SQLite database (via the SQLite online backup API)
/// into a backup folder, typically on OneDrive. The live database never lives in a synced folder.
/// </summary>
public class BackupService(string databasePath)
{
    public const string FilePrefix = "chiefofstaff-";

    public string CreateBackup(string backupFolder, int keep, DateTime? nowLocal = null)
    {
        Directory.CreateDirectory(backupFolder);
        var stamp = (nowLocal ?? DateTime.Now).ToString("yyyyMMdd-HHmmss");
        var target = Path.Combine(backupFolder, $"{FilePrefix}{stamp}.db");

        using (var source = new SqliteConnection($"Data Source={databasePath};Mode=ReadOnly;Pooling=False"))
        using (var destination = new SqliteConnection($"Data Source={target};Pooling=False"))
        {
            source.Open();
            destination.Open();
            source.BackupDatabase(destination);
        }

        Prune(backupFolder, keep);
        return target;
    }

    public static void Prune(string backupFolder, int keep)
    {
        var old = new DirectoryInfo(backupFolder)
            .GetFiles($"{FilePrefix}*.db")
            .OrderByDescending(f => f.Name)
            .Skip(Math.Max(1, keep));
        foreach (var file in old) file.Delete();
    }
}
