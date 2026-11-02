using ChiefOfStaff.App.Views;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace ChiefOfStaff.App;

public sealed partial class MainWindow : Window
{
    private static readonly Dictionary<string, Type> Pages = new()
    {
        ["today"] = typeof(TodayPage),
        ["tasks"] = typeof(TasksPage),
        ["waiting"] = typeof(WaitingOnPage),
        ["projects"] = typeof(ProjectsPage),
        ["people"] = typeof(PeoplePage),
        ["settings"] = typeof(SettingsPage),
    };

    private string? _currentTag;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 860));
        Nav.SelectedItem = Nav.MenuItems[0];
    }

    public void NavigateTo(string tag)
    {
        var item = Nav.MenuItems.OfType<NavigationViewItem>().FirstOrDefault(i => (string)i.Tag == tag);
        if (item is not null) Nav.SelectedItem = item;
    }

    private void Nav_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        var tag = args.IsSettingsSelected ? "settings" : (args.SelectedItem as NavigationViewItem)?.Tag as string;
        if (tag is null || tag == _currentTag) return;
        if (Pages.TryGetValue(tag, out var page)) ContentFrame.Navigate(page);
        else if (ComingSoonPage.Handles(tag)) ContentFrame.Navigate(typeof(ComingSoonPage), tag);
        else return;
        _currentTag = tag;
    }
}
